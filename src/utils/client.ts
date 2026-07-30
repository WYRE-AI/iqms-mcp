import { AsyncLocalStorage } from 'node:async_hooks';
import { IqmsClient } from '@wyre-technology/node-iqms';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Credential types
// ---------------------------------------------------------------------------

interface OracleCreds {
  user: string;
  password: string;
  connectString: string;
}

interface WebApiCreds {
  baseUrl: string;
  username: string;
  password: string;
}

export interface Credentials {
  oracle: OracleCreds;
  webapi: WebApiCreds | null;
}

// ---------------------------------------------------------------------------
// Request-scoped credential store (AsyncLocalStorage)
//
// In gateway mode the HTTP transport calls runWithCredentials({...}) to bind
// all 6 credential fields to the current async context before handing off to
// the MCP server. getCredentials() reads from the ALS store first; if nothing
// is bound (stdio / single-tenant mode) it falls back to process.env.
//
// IMPORTANT: process.env is NEVER mutated in the request path. The ALS store
// is the only mechanism for per-request credential propagation.
// ---------------------------------------------------------------------------

const credStore = new AsyncLocalStorage<Credentials>();

/**
 * Bind `creds` to the current async context and call `fn` inside it.
 * Used by the HTTP transport to establish per-request tenant credentials.
 */
export function runWithCredentials<T>(creds: Credentials, fn: () => T): T {
  return credStore.run(creds, fn);
}

/**
 * Read credentials from the ALS store (gateway / HTTP mode) or from
 * process.env (stdio / single-tenant mode). Returns null if Oracle
 * credentials are not available.
 */
export function getCredentials(): Credentials | null {
  // 1. Request-scoped credentials take priority (gateway / HTTP mode).
  const scoped = credStore.getStore();
  if (scoped) return scoped;

  // 2. Env fallback for stdio / single-tenant deployments.
  const user = process.env.IQMS_ORACLE_USER;
  const password = process.env.IQMS_ORACLE_PASSWORD;
  const connectString = process.env.IQMS_ORACLE_CONNECT_STRING;

  if (!user || !password || !connectString) {
    logger.debug('Oracle credentials missing', {
      hasUser: !!user,
      hasPassword: !!password,
      hasConnectString: !!connectString,
    });
    return null;
  }

  const webapiBaseUrl = process.env.IQMS_WEBAPI_BASE_URL;
  const webapiUser = process.env.IQMS_WEBAPI_USER;
  const webapiPassword = process.env.IQMS_WEBAPI_PASSWORD;

  const webapi: WebApiCreds | null =
    webapiBaseUrl && webapiUser && webapiPassword
      ? { baseUrl: webapiBaseUrl, username: webapiUser, password: webapiPassword }
      : null;

  return { oracle: { user, password, connectString }, webapi };
}

// ---------------------------------------------------------------------------
// Per-tenant client / connection-pool cache
//
// Oracle connection pools are expensive — we must NOT create a fresh pool for
// every request. Instead we maintain a Map keyed by the full credential
// signature. Each tenant gets exactly one pooled IqmsClient reused across all
// their requests. A different tenant (different credential key) NEVER shares a
// pool with another tenant — cross-tenant pool borrowing is structurally
// impossible because the key is derived from the request-scoped credentials.
//
// The Map is process-global (intentionally), but it is safe: it is append-only
// per unique credential set and never mutates a cached entry in place.
//
// The cache stores in-flight Promise<IqmsClient>, not resolved clients. This
// closes a same-tenant race: if two concurrent requests for a brand-new
// credential key both call getClient() before the first IqmsClient.create()
// resolves, a value-cache (Map<string, IqmsClient>) would let both callers
// miss the cache and each create their own Oracle pool — the second .set()
// silently overwrites the first pool reference, orphaning it (never closed,
// holds poolMin..poolMax live Oracle connections forever). Caching the
// pending Promise synchronously — before awaiting — means the second caller
// sees the in-flight promise and awaits the same pool instead of creating a
// duplicate. On rejection the entry is removed so a transient failure (e.g.
// bad credentials, DB unreachable) doesn't permanently poison the cache for
// that key; the next call retries cleanly.
// ---------------------------------------------------------------------------

const _clientCache = new Map<string, Promise<IqmsClient>>();

function credentialKey(creds: Credentials): string {
  // Use arrays (not '@'-joined strings) so field boundaries are unambiguous —
  // this is a tenant-isolation key, so it must be collision-free even if a
  // value happens to contain the separator. Passwords are intentionally
  // excluded (used at pool creation, not for cache identity).
  return JSON.stringify({
    o: [creds.oracle.user, creds.oracle.connectString],
    w: creds.webapi ? [creds.webapi.username, creds.webapi.baseUrl] : null,
  });
}

/**
 * Return (or lazily create) the Oracle connection pool for the current
 * request's tenant. The pool is keyed by the full credential signature so
 * each tenant has an isolated pool and never borrows another tenant's
 * connections.
 */
export async function getClient(): Promise<IqmsClient> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      'No IQMS credentials configured. Set IQMS_ORACLE_USER, IQMS_ORACLE_PASSWORD, ' +
        'and IQMS_ORACLE_CONNECT_STRING. Optionally set IQMS_WEBAPI_BASE_URL / ' +
        'IQMS_WEBAPI_USER / IQMS_WEBAPI_PASSWORD to enable write tools.',
    );
  }

  const key = credentialKey(creds);
  const cached = _clientCache.get(key);
  if (cached) return cached;

  // Register the in-flight promise BEFORE awaiting anything — this is the
  // synchronous step (no `await` between the .get() miss above and this
  // .set()) that closes the concurrent-creation race described above.
  const pending = IqmsClient.create({
    oracle: creds.oracle,
    webapi: creds.webapi ?? undefined,
  }).then((client) => {
    logger.info('Created IQMS client', {
      connectString: creds.oracle.connectString,
      webapi: !!creds.webapi,
    });
    return client;
  });
  pending.catch(() => {
    // Creation failed — don't leave a rejected promise cached forever; let
    // the next call retry (e.g. after a transient DB outage).
    if (_clientCache.get(key) === pending) _clientCache.delete(key);
  });
  _clientCache.set(key, pending);
  return pending;
}

/**
 * Close all pooled clients and clear the cache.
 * Intended for graceful shutdown and test teardown only.
 */
export async function closeAllClients(): Promise<void> {
  const pending = [..._clientCache.values()];
  _clientCache.clear();
  const results = await Promise.allSettled(pending);
  await Promise.all(
    results
      .filter((r): r is PromiseFulfilledResult<IqmsClient> => r.status === 'fulfilled')
      .map((r) => r.value.close().catch(() => undefined)),
  );
}

// ---------------------------------------------------------------------------
// Back-compat shim
//
// resetClient() was needed in the old design because the single-slot cache
// had to be evicted when process.env credentials changed. The new design uses
// per-tenant cache keys and ALS-scoped credentials, so there is nothing to
// reset in the request path. This shim keeps existing callers (tests, etc.)
// compiling; it is a no-op in production and calls closeAllClients() in tests.
// ---------------------------------------------------------------------------

/** @deprecated Use closeAllClients() for graceful shutdown / test teardown. */
export function resetClient(): void {
  void closeAllClients();
}
