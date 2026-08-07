import { createServer as createHttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { getCredentials, runWithCredentials } from './utils/client.js';
import type { Credentials } from './utils/client.js';
import { logger } from './utils/logger.js';
import { verifyS2sHeader, S2S_HEADER } from './s2s-verify.js';

const S2S_SECRET = process.env.CONDUIT_S2S_SECRET || '';

// Map of incoming request header names to their corresponding Credentials fields.
// The six fields cover every secret needed to reach Oracle and the WebAPI module.
// These are READ from headers and passed into runWithCredentials() — process.env
// is NEVER mutated in the request path.
const HEADER_FIELDS = {
  'x-iqms-oracle-user': 'oracleUser',
  'x-iqms-oracle-password': 'oraclePassword',
  'x-iqms-oracle-connect-string': 'oracleConnectString',
  'x-iqms-webapi-base-url': 'webapiBaseUrl',
  'x-iqms-webapi-user': 'webapiUser',
  'x-iqms-webapi-password': 'webapiPassword',
} as const;

/** Extract the 6 credential fields from request headers, or return null if
 *  the required Oracle fields are absent. */
function credentialsFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): Credentials | null {
  const get = (h: string): string | undefined => {
    const v = headers[h];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };

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

function startHttpServer(): void {
  const port = parseInt(process.env.MCP_HTTP_PORT || '8080', 10);
  const host = process.env.MCP_HTTP_HOST || '0.0.0.0';
  const isGatewayMode = process.env.AUTH_MODE === 'gateway';

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      // liveness: must NOT gate on credentials (ACA probe carries none) or the container crash-loops
      const creds = getCredentials();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: creds ? 'ok' : 'degraded',
          transport: 'http',
          credentials: { configured: !!creds, webapi: !!creds?.webapi },
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

    if (S2S_SECRET && !verifyS2sHeader(req.headers[S2S_HEADER] as string | undefined, S2S_SECRET)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.' }));
      return;
    }

    // SECURITY: In gateway mode we extract per-request tenant credentials from
    // the incoming headers and pass them through AsyncLocalStorage via
    // runWithCredentials(). This ensures every async operation spawned inside
    // handle() — including IqmsClient pool lookups — sees the correct tenant's
    // credentials without any process.env mutation.
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
      if (headerCreds) {
        // Bind request-scoped credentials; no process.env mutation occurs.
        await runWithCredentials(headerCreds, handle);
      } else {
        // No credentials in headers — allow through so tools/list works
        // unauthenticated (same behaviour as the old code).
        await handle();
      }
    } else {
      await handle();
    }
  });

  httpServer.listen(port, host, () => {
    logger.info(`HTTP streaming server listening on ${host}:${port}`, {
      gatewayMode: isGatewayMode,
    });
  });
}

const transport = process.env.MCP_TRANSPORT;
if (transport === 'http') {
  startHttpServer();
} else {
  // Defer to stdio entry — keeps a single Docker image usable for both transports.
  await import('./index.js');
}
