import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { runWithCredentials } from './utils/client.js';
import type { Credentials } from './utils/client.js';
import { logger } from './utils/logger.js';
import { verifyS2sHeader, S2S_HEADER } from './s2s-verify.js';

// Conduit service-to-service auth (gateway#377 parity). HTTP startup fails
// closed: an empty CONDUIT_S2S_SECRET, or a known placeholder, refuses to
// boot unless MCP_ALLOW_INSECURE_DEV=1 (placeholders never qualify). That
// bypass skips X-Gateway-S2S and binds 127.0.0.1 only. A configured secret
// is always enforced and still honors MCP_HTTP_HOST (default 0.0.0.0) so
// container deploys keep their existing bind. The secret value is never logged.
// See src/s2s-verify.ts.

/** Public example values. A copied placeholder must not verify as a real secret. */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'replace-with-a-real-secret',
  'your-s2s-secret',
  'your-secret',
  'changeme',
  'change-me',
  'placeholder',
  'secret',
  'example',
  'replace-me',
  's2s-secret',
]);

const LOOPBACK_HOST = '127.0.0.1';

const MISSING_S2S_SECRET_ERROR =
  'Refusing to start HTTP transport: CONDUIT_S2S_SECRET is empty. ' +
  'Set CONDUIT_S2S_SECRET, or set MCP_ALLOW_INSECURE_DEV=1 for local development only.';

const PLACEHOLDER_S2S_SECRET_ERROR =
  'Refusing to start HTTP transport: CONDUIT_S2S_SECRET is a known placeholder. ' +
  'Generate a secret with `openssl rand -hex 32` and set CONDUIT_S2S_SECRET to that value. ' +
  'MCP_ALLOW_INSECURE_DEV does not bypass a placeholder secret.';

const INSECURE_DEV_WARNING =
  'SECURITY WARNING: CONDUIT_S2S_SECRET is empty and MCP_ALLOW_INSECURE_DEV=1. ' +
  'HTTP /mcp is not enforcing X-Gateway-S2S and is limited to loopback (127.0.0.1). ' +
  'Do not use this outside local development.';

const S2S_UNAUTHORIZED = {
  error:
    'Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.',
};

const GATEWAY_CREDENTIALS_UNAUTHORIZED = {
  jsonrpc: '2.0',
  error: {
    code: -32001,
    message:
      'Unauthorized: missing required gateway credential headers x-iqms-oracle-user, x-iqms-oracle-password, and x-iqms-oracle-connect-string',
  },
  id: null,
};

// The six credential headers cover every secret needed to reach Oracle and
// the WebAPI module. They are READ from headers and passed into
// runWithCredentials() — process.env is NEVER mutated in the request path.

function headerValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.+)\]$/, '$1');
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

function refuseStart(message: string): never {
  logger.error(message);
  process.exit(1);
}

/**
 * Secret for X-Gateway-S2S on /mcp. Read at HTTP startup, not module load.
 * Empty is fail-closed unless MCP_ALLOW_INSECURE_DEV=1. A known placeholder
 * always refuses, including when the dev flag is set. The secret is never logged.
 */
function resolveS2sSecret(): string {
  const secret = (process.env.CONDUIT_S2S_SECRET ?? '').trim();
  if (secret && KNOWN_PLACEHOLDER_SECRETS.has(secret.toLowerCase())) {
    refuseStart(PLACEHOLDER_S2S_SECRET_ERROR);
  }
  if (secret) return secret;

  if (process.env.MCP_ALLOW_INSECURE_DEV === '1') {
    // error level so LOG_LEVEL=warn|error cannot hide the bypass.
    logger.error(INSECURE_DEV_WARNING);
    return '';
  }

  refuseStart(MISSING_S2S_SECRET_ERROR);
}

/**
 * No secret (insecure-dev only) always binds 127.0.0.1. A non-loopback
 * MCP_HTTP_HOST is overridden and logged. A configured secret honors
 * MCP_HTTP_HOST, defaulting to 0.0.0.0 so container deploys stay unchanged.
 */
function resolveListenHost(s2sSecret: string): string {
  const configured = (process.env.MCP_HTTP_HOST ?? '').trim();
  if (s2sSecret) return configured || '0.0.0.0';

  if (configured && !isLoopbackHost(configured)) {
    logger.error(
      `WARNING: MCP_HTTP_HOST=${configured} is not a loopback address. ` +
        'MCP_ALLOW_INSECURE_DEV=1 without CONDUIT_S2S_SECRET cannot listen there. ' +
        `Binding ${LOOPBACK_HOST} only.`,
    );
  }
  return LOOPBACK_HOST;
}

/** Extract the 6 credential fields from request headers, or return null if
 *  the required Oracle fields are absent. */
function credentialsFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): Credentials | null {
  const get = (h: string): string | undefined => headerValue(headers[h]);

  const oracleUser = get('x-iqms-oracle-user');
  const oraclePassword = get('x-iqms-oracle-password');
  const oracleConnectString = get('x-iqms-oracle-connect-string');

  if (!oracleUser || !oraclePassword || !oracleConnectString) return null;

  const webapiBaseUrl = get('x-iqms-webapi-base-url');
  const webapiUser = get('x-iqms-webapi-user');
  const webapiPassword = get('x-iqms-webapi-password');

  const webapi =
    webapiBaseUrl && webapiUser && webapiPassword
      ? { baseUrl: webapiBaseUrl, username: webapiUser, password: webapiPassword }
      : null;

  return {
    oracle: { user: oracleUser, password: oraclePassword, connectString: oracleConnectString },
    webapi,
  };
}

export async function startHttpServer(): Promise<HttpServer> {
  const s2sSecret = resolveS2sSecret();
  const port = parseInt(process.env.MCP_HTTP_PORT || '8080', 10);
  const host = resolveListenHost(s2sSecret);
  const isGatewayMode = process.env.AUTH_MODE === 'gateway';

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // Liveness: must NOT gate on credentials (ACA probe carries none) or the
    // container crash-loops. This handler does not read vendor credentials.
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          transport: 'http',
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', endpoints: ['/mcp', '/health'] }));
      return;
    }

    // S2S guard runs first: a forged request must never reach credential
    // extraction or the MCP server/transport. Empty s2sSecret is only
    // reachable when MCP_ALLOW_INSECURE_DEV=1; startup refuses otherwise.
    if (s2sSecret && !verifyS2sHeader(headerValue(req.headers[S2S_HEADER]), s2sSecret)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(S2S_UNAUTHORIZED));
      return;
    }

    // SECURITY: In gateway mode we extract per-request tenant credentials from
    // the incoming headers and pass them through AsyncLocalStorage via
    // runWithCredentials(). This ensures every async operation spawned inside
    // handle() — including IqmsClient pool lookups — sees the correct tenant's
    // credentials without any process.env mutation.
    //
    // Missing Oracle headers are rejected. Falling through would resolve
    // IQMS_* from the process environment, which is not request-scoped.
    //
    // TRANSPORT INVARIANT: sessionIdGenerator is undefined (stateless). Each
    // HTTP request is a self-contained lifecycle. The ALS context opened by
    // runWithCredentials() is alive for exactly that lifecycle, so there is no
    // risk of a stale/foreign credential context leaking to later requests.
    // Do NOT switch to a stateful/SSE transport without re-reviewing this.
    const handle = async () => {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on('close', () => {
        transport.close();
        server.close();
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch (err) {
        logger.error('MCP transport error', { error: (err as Error).message });
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal error' },
              id: null,
            }),
          );
        }
      }
    };

    if (isGatewayMode) {
      const headerCreds = credentialsFromHeaders(req.headers as Record<string, string | string[] | undefined>);
      if (!headerCreds) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(GATEWAY_CREDENTIALS_UNAUTHORIZED));
        return;
      }
      await runWithCredentials(headerCreds, handle);
      return;
    }

    await handle();
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      const bound = httpServer.address();
      const boundHost = bound && typeof bound !== 'string' ? bound.address : host;
      const boundPort = bound && typeof bound !== 'string' ? bound.port : port;
      logger.info(`HTTP streaming server listening on ${boundHost}:${boundPort}`, {
        gatewayMode: isGatewayMode,
        s2sEnforced: s2sSecret !== '',
      });
      resolve();
    });
  });

  return httpServer;
}

// Vitest imports this module to call startHttpServer. Skip the CLI
// entrypoint there. `node dist/http.js` still starts HTTP or falls through
// to stdio.
if (process.env.VITEST !== 'true') {
  if (process.env.MCP_TRANSPORT === 'http') {
    startHttpServer().catch((error) => {
      logger.error('Fatal startup error', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    });
  } else {
    // Defer to stdio entry — keeps a single Docker image usable for both transports.
    await import('./index.js');
  }
}
