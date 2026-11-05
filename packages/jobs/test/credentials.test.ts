import { env } from 'cloudflare:test';
import { getBalance, grantCredits } from '@shipwords/core/credits/ledger';
import { createDb } from '@shipwords/core/db/client';
import { quotaCounters } from '@shipwords/core/db/schema';
import { consumeQuota } from '@shipwords/core/quota/counters';
import type { Core } from '@shipwords/core/server';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import {
  archiveCredential,
  createCredential,
  decryptCredential,
  encryptCredential,
  listCredentials,
  resolveCredential,
  runtimeCredential,
  setDefaultCredential,
  updateCredential,
} from '../src/credentials';
import { createJobs } from '../src/handlers';
import { loadJob } from '../src/lifecycle';
import { getModelConfig, setModelOverride } from '../src/model-overrides';
import type { ModelDefinition } from '../src/models';
import { runGeneration } from '../src/runner';
import { jobs, upstreamCredentials } from '../src/schema';
import { UpstreamError } from '../src/upstream';
import { createAdapterFor, type JobsEnv } from '../src/workflow';
import { YirAdapter } from '../src/yir';

const db = createDb(env.DB);
const keyEnv = () => ({
  CREDENTIALS_KEY: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
});
const fresh = (): ModelDefinition => ({
  id: crypto.randomUUID(),
  name: 'Test',
  kind: 'image',
  upstream: 'yir',
  upstreamModel: 'vendor/test',
  credits: 1,
  guest: false,
  allowedParameters: [],
  maxReferences: 0,
  timeoutMinutes: 10,
});
const keyText = () => `test-credential-${crypto.randomUUID()}`;
const create = async (secretEnv = keyEnv(), apiKey = keyText()) => ({
  ...(await createCredential(db, secretEnv, {
    name: 'Test',
    upstream: 'yir',
    apiKey,
    baseUrl: 'https://upstream.example/api',
  })),
  secretEnv,
  apiKey,
});
async function api(model: ModelDefinition, extraEnv: Record<string, string> = {}) {
  const userId = crypto.randomUUID();
  await grantCredits(db, { userId, amount: 10, idemKey: userId, source: 'test' });
  const handler = createJobs(
    {
      db,
      site: { id: 'test', url: 'https://test.example' },
      getUser: async () => ({ id: userId }),
      log: () => {},
      env: { ...extraEnv, GENERATION_WORKFLOW: { create: async () => ({}) } },
    } as unknown as Core,
    [model],
  );
  const request = () =>
    new Request('https://test.example/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ modelId: model.id, prompt: 'hello' }),
    });
  return { userId, handler, request };
}

describe('encrypted upstream credentials', () => {
  it('sends a D1 key with null baseUrl to the SDK official gateway despite YIR_BASE_URL', async () => {
    const item = await create();
    await updateCredential(db, item.secretEnv, { id: item.id, expectedVersion: 1, baseUrl: null });
    vi.stubEnv('YIR_BASE_URL', 'https://old-gateway.example');
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      requests.push(input instanceof Request ? input.url : String(input));
      return new Response(JSON.stringify({ id: 'up_test', status: 'running' }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    try {
      const adapter = await createAdapterFor(db, {
        ...item.secretEnv,
        YIR_BASE_URL: 'https://old-gateway.example',
      } as JobsEnv)({ upstream: 'yir', credentialId: item.id });
      expect(await adapter.poll('up_test', 0)).toEqual({ state: 'running' });
      expect(requests).toHaveLength(1);
      expect(new URL(requests[0]!).origin).toBe('https://gateway.yir.ai');
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it('rolls back the debit and job if a credential is archived after resolution but before the paid batch', async () => {
    const item = await create();
    const model = { ...fresh(), credentialId: item.id };
    const context = await api(model);
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const realBatch = db.batch.bind(db);
    const batch = vi.spyOn(db, 'batch').mockImplementationOnce(async (items) => {
      reached();
      await gate;
      return realBatch(items);
    });
    const pending = context.handler.create(context.request());
    try {
      await blocked;
      await archiveCredential(db, { id: item.id, expectedVersion: 1 });
      release();
      expect((await pending).status).toBe(400);
      expect((await getBalance(db, context.userId)).available).toBe(10);
      expect(await db.select().from(jobs).where(eq(jobs.userId, context.userId))).toHaveLength(0);
    } finally {
      release();
      await pending;
      batch.mockRestore();
    }
  });

  it('rejects a guest credential archive race and restores the consumed guest quota', async () => {
    const item = await create();
    const model = { ...fresh(), guest: true, credentialId: item.id };
    const guestId = crypto.randomUUID();
    const rule = { key: guestId, window: 'test', limit: 1 };
    const handler = createJobs(
      {
        db,
        site: { id: 'test', url: 'https://test.example' },
        getUser: async () => null,
        env: {},
        log: () => {},
        guest: {
          authorize: async () => {
            expect(await consumeQuota(db, [rule])).toBe(true);
            await archiveCredential(db, { id: item.id, expectedVersion: 1 });
            return { ok: true, guestId, rules: [rule], setCookie: null };
          },
        },
      } as unknown as Core,
      [model],
    );
    const response = await handler.create(
      new Request('https://test.example/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ modelId: model.id, prompt: 'hello' }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await db.select().from(jobs).where(eq(jobs.guestId, guestId))).toHaveLength(0);
    expect((await db.select().from(quotaCounters).where(eq(quotaCounters.key, guestId)).get())!.count).toBe(
      0,
    );
  });

  it('serializes archive against new model references without leaving an archived reference', async () => {
    const item = await create();
    const model = fresh();
    const results = await Promise.allSettled([
      archiveCredential(db, { id: item.id, expectedVersion: 1 }),
      setModelOverride(db, [model], {
        modelId: model.id,
        expectedVersion: 0,
        override: { credentialId: item.id },
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const row = (await listCredentials(db)).credentials.find((credential) => credential.id === item.id)!;
    expect(row.archivedAt === null || row.modelCount === 0).toBe(true);
  });

  it('pins the selected default on creation and uses that job credential when canceling after the default changes', async () => {
    const item = await create();
    const other = await create();
    await setDefaultCredential(db, { upstream: 'yir', id: item.id });
    const model = fresh();
    const context = await api(model, item.secretEnv);
    const response = await context.handler.create(context.request());
    const id = ((await response.json()) as { job: { id: string } }).job.id;
    expect((await loadJob(db, id))!.credentialId).toBe(item.id);
    await setDefaultCredential(db, { upstream: 'yir', id: other.id });
    // The handler's cleanup can see IDs recorded during a cancellation race.
    await db.update(jobs).set({ upstreamJobId: 'up_cancel' }).where(eq(jobs.id, id));
    let usedKey: string | undefined;
    const cancel = vi.spyOn(YirAdapter.prototype, 'cancel').mockImplementation(async function (
      this: YirAdapter,
    ) {
      usedKey = (this as unknown as { options: { apiKey: string } }).options.apiKey;
    });
    try {
      expect((await context.handler.cancel(context.request(), id)).status).toBe(200);
      expect(usedKey).toBe(item.apiKey);
    } finally {
      cancel.mockRestore();
      await setDefaultCredential(db, { upstream: 'yir', id: null });
    }
  });

  it('roundtrips AES-GCM, changes IV, authenticates ID and rejects wrong/missing master keys without exposing plaintext', async () => {
    const secretEnv = keyEnv();
    const apiKey = keyText();
    const encrypted = await encryptCredential(secretEnv, 'cred_test', apiKey);
    expect(await decryptCredential(secretEnv, { id: 'cred_test', ...encrypted })).toBe(apiKey);
    expect(encrypted.keyHint).toBe(apiKey.slice(-4));
    expect(encrypted.keyCiphertext).not.toContain(apiKey);
    expect((await encryptCredential(secretEnv, 'cred_test', apiKey)).keyIv).not.toBe(encrypted.keyIv);
    await expect(decryptCredential(keyEnv(), { id: 'cred_test', ...encrypted })).rejects.toThrow(
      'credential_unavailable',
    );
    await expect(decryptCredential(secretEnv, { id: 'cred_other', ...encrypted })).rejects.toThrow(
      'credential_unavailable',
    );
    for (const CREDENTIALS_KEY of [undefined, 'invalid', btoa('short')]) {
      await expect(
        createCredential(db, { CREDENTIALS_KEY }, { name: 'Test', upstream: 'yir', apiKey }),
      ).rejects.toMatchObject({ status: 400, message: 'credentials_key_missing' });
    }
  });

  it('validates input, updates with new encryption and preserves key on omitted apiKey', async () => {
    const item = await create();
    const before = await db
      .select()
      .from(upstreamCredentials)
      .where(eq(upstreamCredentials.id, item.id))
      .get();
    await updateCredential(db, {}, { id: item.id, expectedVersion: 1, name: 'Renamed', baseUrl: null });
    const retained = await db
      .select()
      .from(upstreamCredentials)
      .where(eq(upstreamCredentials.id, item.id))
      .get();
    expect(retained!.keyCiphertext).toBe(before!.keyCiphertext);
    expect(retained!.baseUrl).toBeNull();
    const changed = keyText();
    await updateCredential(db, item.secretEnv, { id: item.id, expectedVersion: 2, apiKey: changed });
    const row = await db.select().from(upstreamCredentials).where(eq(upstreamCredentials.id, item.id)).get();
    expect(row!.keyIv).not.toBe(before!.keyIv);
    expect(await decryptCredential(item.secretEnv, row!)).toBe(changed);
    for (const bad of [
      { name: '' },
      { name: 'x'.repeat(101) },
      { baseUrl: 'http://example.com' },
      { baseUrl: 'https://[' },
      { apiKey: ' key ' },
      { apiKey: '' },
      { upstream: 'unknown' },
    ]) {
      await expect(
        createCredential(db, item.secretEnv, { name: 'Test', upstream: 'yir', apiKey: changed, ...bad }),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it('uses optimistic versions for concurrent updates and returns only safe list fields', async () => {
    const item = await create();
    const results = await Promise.allSettled(
      ['First', 'Second'].map((name) =>
        updateCredential(db, item.secretEnv, { id: item.id, expectedVersion: 1, name }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    const listed = (await listCredentials(db)).credentials.find((credential) => credential.id === item.id)!;
    expect(Object.keys(listed).sort()).toEqual(
      [
        'id',
        'name',
        'upstream',
        'baseUrl',
        'keyHint',
        'isDefault',
        'archivedAt',
        'version',
        'createdAt',
        'updatedAt',
        'modelCount',
        'activeJobCount',
      ].sort(),
    );
    expect(JSON.stringify(listed)).not.toContain(item.apiKey);
  });

  it('resolves explicit then default then env and enforces a single default under races', async () => {
    await setDefaultCredential(db, { upstream: 'yir', id: null });
    const first = await create();
    const second = await create();
    expect(await resolveCredential(db, 'yir')).toBeNull();
    await setDefaultCredential(db, { upstream: 'yir', id: first.id });
    expect(await resolveCredential(db, 'yir', null)).toBe(first.id);
    expect(await resolveCredential(db, 'yir', second.id)).toBe(second.id);
    await Promise.all([first.id, second.id].map((id) => setDefaultCredential(db, { upstream: 'yir', id })));
    expect((await listCredentials(db)).credentials.filter((row) => row.isDefault)).toHaveLength(1);
    await expect(setDefaultCredential(db, { upstream: 'yir', id: 'missing' })).rejects.toMatchObject({
      status: 404,
    });
    await setDefaultCredential(db, { upstream: 'yir', id: null });
  });

  it('blocks archive while referenced by defaults or model overrides, but permits archived runtime reads', async () => {
    const item = await create();
    const model = fresh();
    await setModelOverride(db, [model], {
      modelId: model.id,
      expectedVersion: 0,
      override: { credentialId: item.id },
    });
    await expect(archiveCredential(db, { id: item.id, expectedVersion: 1 })).rejects.toMatchObject({
      status: 409,
      message: 'credential_in_use',
    });
    expect((await getModelConfig(db, [model])).models[0]).toMatchObject({
      upstream: 'yir',
      credentialId: item.id,
    });
    expect((await listCredentials(db)).credentials.find((row) => row.id === item.id)!.modelCount).toBe(1);
    await setModelOverride(db, [model], { modelId: model.id, expectedVersion: 1 }, true);
    await setDefaultCredential(db, { upstream: 'yir', id: item.id });
    const defaultRow = (await listCredentials(db)).credentials.find((row) => row.id === item.id)!;
    await expect(
      archiveCredential(db, { id: item.id, expectedVersion: defaultRow.version }),
    ).rejects.toMatchObject({ status: 409, message: 'credential_in_use' });
    await setDefaultCredential(db, { upstream: 'yir', id: null });
    const current = (await listCredentials(db)).credentials.find((row) => row.id === item.id)!;
    await archiveCredential(db, { id: item.id, expectedVersion: current.version });
    expect((await runtimeCredential(db, item.secretEnv, item.id, 'yir')).apiKey).toBe(item.apiKey);
    await expect(resolveCredential(db, 'yir', item.id)).rejects.toMatchObject({ status: 400 });
    await expect(
      setModelOverride(db, [model], {
        modelId: model.id,
        expectedVersion: 2,
        override: { credentialId: item.id },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects missing, archived or mismatched references before charging and mock ignores all credentials', async () => {
    const archived = await create();
    await archiveCredential(db, { id: archived.id, expectedVersion: 1 });
    const mismatch = await create();
    await db
      .update(upstreamCredentials)
      .set({ upstream: 'other' })
      .where(eq(upstreamCredentials.id, mismatch.id));
    for (const credentialId of ['missing', archived.id, mismatch.id]) {
      const model = { ...fresh(), credentialId };
      const context = await api(model);
      expect((await context.handler.create(context.request())).status).toBe(400);
      expect((await getBalance(db, context.userId)).available).toBe(10);
      expect(await db.select().from(jobs).where(eq(jobs.userId, context.userId))).toHaveLength(0);
      await expect(
        setModelOverride(db, [model], { modelId: model.id, expectedVersion: 0, override: { credentialId } }),
      ).rejects.toMatchObject({ status: 400 });
    }
    const model = { ...fresh(), credentialId: 'missing' };
    const context = await api(model, { UPSTREAM_MOCK: '1', APP_URL: 'http://localhost:5173' });
    const response = await context.handler.create(context.request());
    expect(response.status).toBe(201);
    const { job } = (await response.json()) as { job: { id: string } };
    expect((await loadJob(db, job.id))!.credentialId).toBeNull();
    const mock = await createAdapterFor(db, {
      UPSTREAM_MOCK: '1',
      APP_URL: 'http://localhost:5173',
    } as JobsEnv)({ upstream: 'yir', credentialId: 'missing' });
    expect(mock.name).toBe('mock');
    await expect(
      createAdapterFor(db, { UPSTREAM_MOCK: '1', APP_URL: 'https://live.example' } as JobsEnv)({
        upstream: 'yir',
        credentialId: 'missing',
      }),
    ).rejects.toThrow(/refusing/);
  });

  it('pins credential_id, decrypts only inside steps, uses edits on the next call and never persists plaintext', async () => {
    const item = await create();
    const model = fresh();
    await setModelOverride(db, [model], {
      modelId: model.id,
      expectedVersion: 0,
      override: { credentialId: item.id },
    });
    const context = await api(model);
    const response = await context.handler.create(context.request());
    const { job } = (await response.json()) as { job: { id: string } };
    expect((await loadJob(db, job.id))!.credentialId).toBe(item.id);
    expect((await listCredentials(db)).credentials.find((row) => row.id === item.id)!.activeJobCount).toBe(1);
    // Clearing the model reference does not change the job's selected credential.
    await setModelOverride(db, [model], { modelId: model.id, expectedVersion: 1 }, true);
    const calls: string[] = [];
    const edited = keyText();
    let inside = false;
    const submit = vi.spyOn(YirAdapter.prototype, 'submit').mockImplementation(async function (
      this: YirAdapter,
    ) {
      expect(inside).toBe(true);
      calls.push((this as unknown as { options: { apiKey: string } }).options.apiKey);
      return { upstreamJobId: 'up_test' };
    });
    const poll = vi.spyOn(YirAdapter.prototype, 'poll').mockImplementation(async function (this: YirAdapter) {
      expect(inside).toBe(true);
      calls.push((this as unknown as { options: { apiKey: string } }).options.apiKey);
      return { state: 'succeeded', files: [{ url: 'https://up/image.png', mediaType: 'image/png' }] };
    });
    const cost = vi.spyOn(YirAdapter.prototype, 'cost').mockResolvedValue({ usd: '0', settled: true });
    const results: unknown[] = [];
    try {
      const adapterFor = createAdapterFor(db, { ...item.secretEnv, YIR_API_KEY: 'unused' } as JobsEnv);
      await runGeneration(
        {
          db,
          bucket: env.OUTPUTS,
          models: [model],
          adapterFor: async (row) => {
            expect(inside).toBe(true);
            expect(row.credentialId).toBe(item.id);
            return adapterFor(row);
          },
          fetcher: async () => new Response(new Uint8Array([1])),
        },
        job.id,
        {
          async do(name, fn) {
            inside = true;
            try {
              const value = await fn();
              results.push(structuredClone(value));
              if (name === 'submit')
                await updateCredential(db, item.secretEnv, {
                  id: item.id,
                  expectedVersion: 1,
                  apiKey: edited,
                });
              return value;
            } finally {
              inside = false;
            }
          },
          async sleep() {},
        },
      );
    } finally {
      submit.mockRestore();
      poll.mockRestore();
      cost.mockRestore();
    }
    expect(calls).toEqual([item.apiKey, edited]);
    expect(JSON.stringify(results)).not.toContain(item.apiKey);
    expect(JSON.stringify(results)).not.toContain(edited);
    expect((await loadJob(db, job.id))!.status).toBe('succeeded');
  });

  it('refunds a decryption failure before any submission and never refunds a submitted job for credential failure', async () => {
    const item = await create();
    const model = { ...fresh(), credentialId: item.id };
    const context = await api(model);
    const first = await context.handler.create(context.request());
    const firstId = ((await first.json()) as { job: { id: string } }).job.id;
    const deps = {
      db,
      bucket: env.OUTPUTS,
      models: [model],
      adapterFor: createAdapterFor(db, {} as JobsEnv),
    };
    const steps = { do: async <T>(_name: string, fn: () => Promise<T>) => fn(), sleep: async () => {} };
    await runGeneration(deps, firstId, steps);
    expect((await loadJob(db, firstId))!.status).toBe('failed');
    expect((await getBalance(db, context.userId)).available).toBe(10);
    const second = await context.handler.create(context.request());
    const secondId = ((await second.json()) as { job: { id: string } }).job.id;
    await db
      .update(jobs)
      .set({ status: 'submitted', upstreamJobId: 'up_existing' })
      .where(eq(jobs.id, secondId));
    await runGeneration(deps, secondId, steps);
    expect((await loadJob(db, secondId))!).toMatchObject({
      status: 'failed',
      errorCode: 'credential_unavailable',
    });
    await db
      .update(jobs)
      .set({ createdAt: Date.now() - 60 * 60_000 })
      .where(eq(jobs.id, secondId));
    expect((await context.handler.get(context.request(), secondId)).status).toBe(200);
    expect((await context.handler.list(context.request())).status).toBe(200);
    expect((await context.handler.get(context.request(), secondId)).status).toBe(200);
    expect((await getBalance(db, context.userId)).available).toBe(9);
  });

  it('persists non-refund credential failure before Workflow serialization can erase the error prototype', async () => {
    const context = await api(fresh());
    const response = await context.handler.create(context.request());
    const id = ((await response.json()) as { job: { id: string } }).job.id;
    const row = (await loadJob(db, id))!;
    await db.update(jobs).set({ status: 'submitted', upstreamJobId: 'up_paid' }).where(eq(jobs.id, id));
    const model = { ...fresh(), id: row.modelId };
    await runGeneration(
      {
        db,
        bucket: env.OUTPUTS,
        models: [model],
        adapterFor: async () => {
          throw { name: 'CredentialError', message: 'credential_unavailable' };
        },
      },
      id,
      {
        async do(_name, fn) {
          try {
            return await fn();
          } catch (error) {
            throw new Error(error instanceof Error ? error.message : 'serialized step failure');
          }
        },
        async sleep() {},
      },
    );
    expect((await loadJob(db, id))!).toMatchObject({ status: 'failed', errorCode: 'credential_unavailable' });
    expect((await getBalance(db, context.userId)).available).toBe(9);
  });

  it('redacts echoed keys from provider errors before logging or storing them', async () => {
    const item = await create();
    const model = { ...fresh(), credentialId: item.id };
    const context = await api(model);
    const response = await context.handler.create(context.request());
    const id = ((await response.json()) as { job: { id: string } }).job.id;
    const submit = vi
      .spyOn(YirAdapter.prototype, 'submit')
      .mockRejectedValue(new UpstreamError('rejected', `echo ${item.apiKey}`, false));
    const cost = vi.spyOn(YirAdapter.prototype, 'cost').mockResolvedValue({ usd: '0', settled: true });
    const logs: unknown[] = [];
    try {
      await runGeneration(
        {
          db,
          bucket: env.OUTPUTS,
          models: [model],
          adapterFor: createAdapterFor(db, item.secretEnv as JobsEnv),
          log: (...args) => {
            logs.push(args);
          },
        },
        id,
        { do: async (_name, fn) => fn(), sleep: async () => {} },
      );
    } finally {
      submit.mockRestore();
      cost.mockRestore();
    }
    expect(JSON.stringify(logs)).not.toContain(item.apiKey);
    expect((await loadJob(db, id))!.errorMessage).not.toContain(item.apiKey);
  });
});
