import { afterEach, describe, expect, it, vi } from 'vitest';

// Vitest hoists vi.mock() above imports/const declarations, so mock state
// that the factory needs to close over must go through vi.hoisted().
const { createMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
}));

vi.mock('@wyre-technology/node-iqms', () => ({
  IqmsClient: {
    create: (...args: unknown[]) => createMock(...args),
  },
}));

import { runWithCredentials, getClient, closeAllClients } from '../../src/utils/client.js';
import type { Credentials } from '../../src/utils/client.js';

const TENANT: Credentials = {
  oracle: { user: 'race_user', password: 'race_pass', connectString: 'host-race:1521/EIQ' },
  webapi: null,
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('getClient — concurrent cold-start pool creation', () => {
  afterEach(async () => {
    createMock.mockReset();
    await closeAllClients();
  });

  it('dedupes concurrent creation for the same never-before-seen tenant (single-flight)', async () => {
    // Regression test for a same-tenant resource leak: without single-flight
    // dedup, two concurrent getClient() calls for a brand-new credential key
    // would both miss the cache (since nothing is cached until creation
    // resolves) and each open a separate Oracle pool. The second cache
    // .set() would silently overwrite the first pool reference, orphaning
    // it — that pool is then never closed by closeAllClients() because it
    // no longer appears in the map, leaking up to poolMax live Oracle
    // connections for the lifetime of the process.
    const d = deferred<{ close: () => Promise<void> }>();
    createMock.mockReturnValue(d.promise);

    const fakeClient = { close: vi.fn(async () => undefined) };

    const callA = runWithCredentials(TENANT, () => getClient());
    const callB = runWithCredentials(TENANT, () => getClient());

    // Both calls must have resolved to the SAME in-flight promise
    // synchronously, before creation ever settles.
    expect(createMock).toHaveBeenCalledTimes(1);

    d.resolve(fakeClient);

    const [clientA, clientB] = await Promise.all([callA, callB]);

    expect(clientA).toBe(fakeClient);
    expect(clientB).toBe(fakeClient);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('removes the cache entry on creation failure so the next call retries', async () => {
    createMock.mockRejectedValueOnce(new Error('ORA-12154: TNS unreachable'));

    await expect(runWithCredentials(TENANT, () => getClient())).rejects.toThrow(
      'TNS unreachable',
    );

    const fakeClient = { close: vi.fn(async () => undefined) };
    createMock.mockResolvedValueOnce(fakeClient);

    const client = await runWithCredentials(TENANT, () => getClient());

    expect(client).toBe(fakeClient);
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});
