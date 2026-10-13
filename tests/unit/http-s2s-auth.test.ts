/**
 * HTTP transport fail-closed auth.
 *
 * Startup requires a real CONDUIT_S2S_SECRET unless MCP_ALLOW_INSECURE_DEV=1.
 * Known placeholders never count. /mcp rejects a missing or invalid
 * X-Gateway-S2S header. AUTH_MODE=gateway rejects requests that omit the
 * Oracle credential headers and must not fall back to IQMS_* in process.env.
 */

import { createHmac } from 'node:crypto';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHttpServer } from '../../src/http.js';

const S2S_SECRET = 's2s-do-not-log-7f3a';
const ENV_USER = 'env-oracle-user-must-not-be-used';
const ENV_PASSWORD = 'env-oracle-password-must-not-be-used';
const ENV_CONNECT = 'env-host.example:1521/MUSTNOTUSE';
const HEADER_USER = 'header-oracle-user';
const HEADER_PASSWORD = 'header-oracle-password';
const HEADER_CONNECT = 'header-host.example:1521/EIQ';
const PLACEHOLDER = 'replace-with-a-real-secret';

const PLACEHOLDERS = [
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
] as const;

const ENV_KEYS = [
  'CONDUIT_S2S_SECRET',
  'MCP_ALLOW_INSECURE_DEV',
  'MCP_HTTP_PORT',
  'MCP_HTTP_HOST',
  'AUTH_MODE',
  'IQMS_ORACLE_USER',
  'IQMS_ORACLE_PASSWORD',
  'IQMS_ORACLE_CONNECT_STRING',
  'IQMS_WEBAPI_BASE_URL',
  'IQMS_WEBAPI_USER',
  'IQMS_WEBAPI_PASSWORD',
  'LOG_LEVEL',
  'MCP_TRANSPORT',
] as const;

const savedEnv = new Map<string, string | undefined>();
const servers: Server[] = [];

function mintS2sHeader(secret: string, unixSeconds = Math.floor(Date.now() / 1000)): string {
  const message = `t=${unixSeconds}`;
  const hex = createHmac('sha256', secret).update(message).digest('hex');
  return `${message},v1=${hex}`;
}

function captureStderr(): { text: () => string; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  });
  return {
    text: () => lines.join('\n'),
    restore: () => spy.mockRestore(),
  };
}

interface HttpResult {
  status: number;
  body: string;
}

function sendHttp(options: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: options.port,
        method: options.method,
        path: options.path,
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.setTimeout(5000, () => {
      req.destroy(new Error(`timeout ${options.method} ${options.path}`));
    });
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

async function listen(): Promise<{ port: number; address: string; server: Server }> {
  const server = await startHttpServer();
  servers.push(server);
  const bound = server.address() as AddressInfo | null;
  if (!bound || typeof bound === 'string') {
    throw new Error('HTTP server did not bind a TCP port');
  }
  return { port: bound.port, address: bound.address, server };
}

function mcpHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...extra,
  };
}

const oracleHeaders = {
  'x-iqms-oracle-user': HEADER_USER,
  'x-iqms-oracle-password': HEADER_PASSWORD,
  'x-iqms-oracle-connect-string': HEADER_CONNECT,
};

const statusCall = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'iqms_status', arguments: {} },
});

function mockExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${String(code)}`);
  }) as typeof process.exit);
}

function assertNoSecrets(text: string): void {
  expect(text).not.toContain(S2S_SECRET);
  expect(text).not.toContain(ENV_USER);
  expect(text).not.toContain(ENV_PASSWORD);
  expect(text).not.toContain(ENV_CONNECT);
  expect(text).not.toContain(HEADER_PASSWORD);
  expect(text).not.toContain(PLACEHOLDER);
}

function statusPayload(body: string): { oracleConnected?: boolean; webapiEnabled?: boolean } {
  const payload = JSON.parse(body) as {
    result?: { content?: Array<{ text?: string }> };
  };
  const text = payload.result?.content?.[0]?.text ?? '';
  return JSON.parse(text) as { oracleConnected?: boolean; webapiEnabled?: boolean };
}

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  process.env.MCP_HTTP_PORT = '0';
  process.env.MCP_HTTP_HOST = '127.0.0.1';
  process.env.LOG_LEVEL = 'info';
  delete process.env.CONDUIT_S2S_SECRET;
  delete process.env.MCP_ALLOW_INSECURE_DEV;
  delete process.env.AUTH_MODE;
  delete process.env.IQMS_ORACLE_USER;
  delete process.env.IQMS_ORACLE_PASSWORD;
  delete process.env.IQMS_ORACLE_CONNECT_STRING;
  delete process.env.IQMS_WEBAPI_BASE_URL;
  delete process.env.IQMS_WEBAPI_USER;
  delete process.env.IQMS_WEBAPI_PASSWORD;
  delete process.env.MCP_TRANSPORT;
});

afterEach(async () => {
  vi.restoreAllMocks();
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) continue;
    await new Promise<void>((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe('HTTP startup', () => {
  it('refuses to start when CONDUIT_S2S_SECRET is empty', async () => {
    const logs = captureStderr();
    const exitSpy = mockExit();

    try {
      await expect(startHttpServer()).rejects.toThrow('process.exit:1');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const text = logs.text();
      expect(text).toContain('Refusing to start HTTP transport');
      expect(text).toContain('CONDUIT_S2S_SECRET');
      assertNoSecrets(text);
    } finally {
      logs.restore();
    }
  });

  it('still refuses when MCP_ALLOW_INSECURE_DEV is not exactly 1', async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = 'true';
    process.env.CONDUIT_S2S_SECRET = '   ';
    const logs = captureStderr();
    mockExit();

    try {
      await expect(startHttpServer()).rejects.toThrow('process.exit:1');
      expect(logs.text()).toContain('Refusing to start HTTP transport');
      assertNoSecrets(logs.text());
    } finally {
      logs.restore();
    }
  });

  it.each(PLACEHOLDERS)('refuses known placeholder %s and does not log it', async (placeholder) => {
    process.env.CONDUIT_S2S_SECRET = `  ${placeholder.toUpperCase()}  `;
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    const logs = captureStderr();
    const exitSpy = mockExit();

    try {
      await expect(startHttpServer()).rejects.toThrow('process.exit:1');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const text = logs.text();
      expect(text).toContain('known placeholder');
      expect(text).toContain('Refusing to start HTTP transport');
      expect(text).not.toContain(`  ${placeholder.toUpperCase()}  `);
      const staticRefusal =
        'Refusing to start HTTP transport: CONDUIT_S2S_SECRET is a known placeholder. ' +
        'Generate a secret with `openssl rand -hex 32` and set CONDUIT_S2S_SECRET to that value. ' +
        'MCP_ALLOW_INSECURE_DEV does not bypass a placeholder secret.';
      if (!staticRefusal.toLowerCase().includes(placeholder.toLowerCase())) {
        expect(text.toLowerCase()).not.toContain(placeholder.toLowerCase());
      }
      assertNoSecrets(text);
    } finally {
      logs.restore();
    }
  });

  it('allows startup with a warning when MCP_ALLOW_INSECURE_DEV=1 and binds 127.0.0.1', async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    delete process.env.MCP_HTTP_HOST;
    const logs = captureStderr();
    const exitSpy = mockExit();

    try {
      const server = await listen();
      expect(exitSpy).not.toHaveBeenCalled();
      expect(server.address).toBe('127.0.0.1');
      const text = logs.text();
      expect(text).toContain('SECURITY WARNING');
      expect(text).toContain('CONDUIT_S2S_SECRET');
      expect(text).toContain('MCP_ALLOW_INSECURE_DEV');
      expect(text).toContain('127.0.0.1');
      expect(text).not.toContain('not a loopback address');
      assertNoSecrets(text);
    } finally {
      logs.restore();
    }
  });

  it.each(['0.0.0.0', '10.1.2.3'])(
    'overrides non-loopback MCP_HTTP_HOST=%s when the dev bypass is on',
    async (host) => {
      process.env.MCP_ALLOW_INSECURE_DEV = '1';
      process.env.MCP_HTTP_HOST = host;
      const logs = captureStderr();
      const exitSpy = mockExit();

      try {
        const server = await listen();
        expect(exitSpy).not.toHaveBeenCalled();
        expect(server.address).toBe('127.0.0.1');
        const text = logs.text();
        expect(text).toContain(`MCP_HTTP_HOST=${host} is not a loopback address`);
        expect(text).toContain('Binding 127.0.0.1 only');
        assertNoSecrets(text);
      } finally {
        logs.restore();
      }
    },
  );

  it('forces 127.0.0.1 when the dev bypass host is localhost or ::1', async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    process.env.MCP_HTTP_HOST = '[::1]';
    const logs = captureStderr();

    try {
      const server = await listen();
      expect(server.address).toBe('127.0.0.1');
      expect(logs.text()).toContain('SECURITY WARNING');
      expect(logs.text()).not.toContain('not a loopback address');
    } finally {
      logs.restore();
    }
  });

  it('honors a non-loopback MCP_HTTP_HOST when CONDUIT_S2S_SECRET is set', async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.MCP_HTTP_HOST = '0.0.0.0';
    const logs = captureStderr();

    try {
      const server = await listen();
      expect(server.address).toBe('0.0.0.0');
      expect(logs.text()).not.toContain('not a loopback address');
      assertNoSecrets(logs.text());
    } finally {
      logs.restore();
    }
  });

  it('binds 0.0.0.0 when a secret is set and MCP_HTTP_HOST is unset', async () => {
    delete process.env.MCP_HTTP_HOST;
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    const server = await listen();
    expect(server.address).toBe('0.0.0.0');
  });
});

describe('HTTP /mcp authentication', () => {
  beforeEach(() => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.AUTH_MODE = 'gateway';
    process.env.IQMS_ORACLE_USER = ENV_USER;
    process.env.IQMS_ORACLE_PASSWORD = ENV_PASSWORD;
    process.env.IQMS_ORACLE_CONNECT_STRING = ENV_CONNECT;
    process.env.MCP_HTTP_HOST = '127.0.0.1';
  });

  it('returns 401 when the S2S header is missing or invalid and does not log the secret', async () => {
    const logs = captureStderr();
    const server = await listen();
    try {
      const missing = await sendHttp({
        port: server.port,
        method: 'POST',
        path: '/mcp',
        headers: mcpHeaders(oracleHeaders),
        body: statusCall,
      });
      const invalid = await sendHttp({
        port: server.port,
        method: 'POST',
        path: '/mcp',
        headers: mcpHeaders({
          ...oracleHeaders,
          'x-gateway-s2s': mintS2sHeader('wrong-secret'),
        }),
        body: statusCall,
      });

      expect(missing.status).toBe(401);
      expect(invalid.status).toBe(401);
      expect(missing.body).toContain('X-Gateway-S2S');
      expect(invalid.body).toContain('X-Gateway-S2S');
      assertNoSecrets(missing.body);
      assertNoSecrets(invalid.body);
      assertNoSecrets(logs.text());
    } finally {
      logs.restore();
    }
  });

  it('returns 401 in gateway mode without credential headers and does not use env credentials', async () => {
    const server = await listen();
    const response = await sendHttp({
      port: server.port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders({ 'x-gateway-s2s': mintS2sHeader(S2S_SECRET) }),
      body: statusCall,
    });

    expect(response.status).toBe(401);
    expect(response.body).toContain('x-iqms-oracle-user');
    expect(response.body).toContain('x-iqms-oracle-password');
    expect(response.body).toContain('x-iqms-oracle-connect-string');
    expect(response.body).toContain('Unauthorized');
    expect(JSON.parse(response.body)).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32001 },
      id: null,
    });
    assertNoSecrets(response.body);

    const partial = await sendHttp({
      port: server.port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders({
        'x-gateway-s2s': mintS2sHeader(S2S_SECRET),
        'x-iqms-oracle-user': HEADER_USER,
        'x-iqms-oracle-password': HEADER_PASSWORD,
      }),
      body: statusCall,
    });
    expect(partial.status).toBe(401);
    assertNoSecrets(partial.body);
  });

  it('accepts a valid S2S header plus Oracle headers and uses those credentials', async () => {
    const logs = captureStderr();
    const server = await listen();
    try {
      const response = await sendHttp({
        port: server.port,
        method: 'POST',
        path: '/mcp',
        headers: mcpHeaders({
          'x-gateway-s2s': mintS2sHeader(S2S_SECRET),
          ...oracleHeaders,
          'x-iqms-webapi-base-url': 'https://eiq.example/webapi',
          'x-iqms-webapi-user': 'webapi-user',
          'x-iqms-webapi-password': 'webapi-password-must-not-leak',
        }),
        body: statusCall,
      });

      expect(response.status).toBe(200);
      expect(statusPayload(response.body)).toMatchObject({
        oracleConnected: true,
        webapiEnabled: true,
      });
      expect(response.body).not.toContain('webapi-password-must-not-leak');
      assertNoSecrets(response.body);
      assertNoSecrets(logs.text());
    } finally {
      logs.restore();
    }
  });

  it('serves /health without authentication and without reading credentials', async () => {
    const server = await listen();
    const response = await sendHttp({
      port: server.port,
      method: 'GET',
      path: '/health',
    });
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body) as { status?: string; credentials?: unknown };
    expect(body.status).toBe('ok');
    expect(body.credentials).toBeUndefined();
    assertNoSecrets(response.body);
  });
});

describe('HTTP AUTH_MODE=env', () => {
  beforeEach(() => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.AUTH_MODE = 'env';
    process.env.IQMS_ORACLE_USER = ENV_USER;
    process.env.IQMS_ORACLE_PASSWORD = ENV_PASSWORD;
    process.env.IQMS_ORACLE_CONNECT_STRING = ENV_CONNECT;
    process.env.MCP_HTTP_HOST = '127.0.0.1';
  });

  it('accepts a signed request that omits vendor headers and uses env credentials', async () => {
    const server = await listen();
    const response = await sendHttp({
      port: server.port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders({ 'x-gateway-s2s': mintS2sHeader(S2S_SECRET) }),
      body: statusCall,
    });

    expect(response.status).toBe(200);
    expect(statusPayload(response.body)).toMatchObject({
      oracleConnected: true,
      webapiEnabled: false,
    });
    assertNoSecrets(response.body);
  });
});
