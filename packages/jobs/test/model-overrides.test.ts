import { env } from 'cloudflare:test';
import { AdminRequestError } from '@shipwords/core/admin';
import { getBalance, grantCredits } from '@shipwords/core/credits/ledger';
import { createDb } from '@shipwords/core/db/client';
import type { Core } from '@shipwords/core/server';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import tinydesk from '../../../sites/tinydeskai-example/src/models.server';
import { createJobs } from '../src/handlers';
import { loadJob } from '../src/lifecycle';
import {
  effectiveModel,
  getModelConfig,
  getModelPrices,
  readModelOverride,
  setModelOverride,
} from '../src/model-overrides';
import { type ModelDefinition, renderPrompt, validateModel } from '../src/models';
import { runGeneration } from '../src/runner';
import { jobs } from '../src/schema';
import type { SubmitInput, UpstreamAdapter } from '../src/upstream';
import expectedPrompts from './tinydesk-prompts.json';

const db = createDb(env.DB);
const base: ModelDefinition = {
  id: 'config',
  name: 'Config',
  kind: 'image',
  upstream: 'yir',
  upstreamModel: 'vendor/default',
  credits: 2,
  guest: false,
  allowedParameters: [],
  maxReferences: 0,
  maxCost: '1.00',
  timeoutMinutes: 10,
};
const fresh = () => ({ ...base, id: crypto.randomUUID() });

describe('editable model configuration', () => {
  it('compares fractional USD budgets exactly, accepts equality and rejects excess precision in defaults and overrides', () => {
    const model = tinydesk[0]!;
    expect(() => effectiveModel(model, { prep: { maxCost: '0.024' } })).toThrow(/exceeds/);
    expect(() => effectiveModel(model, { prep: { maxCost: '0.020000' } })).not.toThrow();
    expect(() => effectiveModel(model, { prep: { maxCost: '0.020001' } })).toThrow(/exceeds/);
    expect(() => effectiveModel(model, { prep: { maxCost: '0.0200001' } })).toThrow(/6 decimal/);
    expect(() => validateModel({ ...model, maxCost: '5.6000001' })).toThrow(/6 decimal/);
    expect(() =>
      validateModel({
        ...model,
        effect: { ...model.effect!, prep: { ...model.effect!.prep!, maxCost: '0.024' } },
      }),
    ).toThrow(/exceeds/);
  });

  it('normalizes concurrent identical requests against the persisted winner snapshot after overrides change', async () => {
    const model = { ...tinydesk[0]!, id: crypto.randomUUID(), credits: 1 };
    const userId = crypto.randomUUID();
    await grantCredits(db, { userId, amount: 20, idemKey: userId, source: 'test' });
    const api = createJobs(
      {
        db,
        site: { id: 'test', url: 'https://test.example' },
        getUser: async () => ({ id: userId }),
        log: () => {},
        env: {
          GENERATION_WORKFLOW: {
            create: async () => ({}),
            get: async () => ({ status: async () => ({ status: 'running' }) }),
          },
        },
      } as unknown as Core,
      [model],
    );
    const create = () =>
      api.create(
        new Request('https://test.example/api/jobs', {
          method: 'POST',
          body: JSON.stringify({ modelId: model.id, slots: { lead: '/files/uploads/up_a.png' } }),
        }),
        { idempotencyKey: 'same-body' },
      );
    await setModelOverride(db, [model], {
      modelId: model.id,
      override: { upstreamModel: 'vendor/first' },
      expectedVersion: 0,
    });
    let release!: () => void;
    let reached!: () => void;
    const blocked = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realBatch = db.batch.bind(db);
    const batch = vi.spyOn(db, 'batch').mockImplementationOnce(async (items) => {
      reached();
      await gate;
      return realBatch(items);
    });
    const first = create();
    try {
      await blocked;
      await setModelOverride(db, [model], {
        modelId: model.id,
        override: { upstreamModel: 'vendor/winner' },
        expectedVersion: 1,
      });
      const second = await create();
      release();
      const response = await first;
      expect([response.status, second.status]).toEqual([200, 200]);
      expect(((await response.json()) as { job: { id: string } }).job.id).toBe(
        ((await second.json()) as { job: { id: string } }).job.id,
      );
      expect((await getBalance(db, userId)).available).toBe(19);
      const rows = await db.select().from(jobs).where(eq(jobs.userId, userId));
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0]!.overrideJson!)).toEqual({ upstreamModel: 'vendor/winner' });
    } finally {
      release();
      await first;
      batch.mockRestore();
    }
  });

  it('renders the original tinydesk edit and repair prompts byte for byte for one, some and all five seats', () => {
    const segment = tinydesk[0]!.effect!.segments[0]!;
    for (const expected of expectedPrompts) {
      const images = Object.fromEntries(expected.slots.map((slot, i) => [slot, `@image${i + 1}`]));
      expect(renderPrompt(segment.prompt, images)).toBe(expected.edit);
      expect(renderPrompt(segment.repair!.prompt, expected.slots)).toBe(expected.repair);
    }
  });

  it('rejects non-editable fields at every level and invalid typed values', () => {
    const model = tinydesk[0]!;
    const invalid = [
      { upstream: 'other' },
      { effect: {} },
      { credits: -1 },
      { credits: 1.5 },
      { credits: '1' },
      { enabled: 0 },
      { timeoutMinutes: 0 },
      { timeoutMinutes: '10' },
      { maxCost: 'NaN' },
      { maxCost: 'Infinity' },
      { upstreamModel: '' },
      { prep: { parameters: {} } },
      { prep: { prompt: 'x'.repeat(8001) } },
      { segments: { missing: {} } },
      { segments: { full: { referenceVideo: 'https://evil.test' } } },
      { segments: { full: { parameters: [] } } },
      { segments: { full: { repair: { onMiss: 'refund' } } } },
      { segments: { full: { repair: { rounds: 0 } } } },
      { segments: { full: { repair: { maxCost: 'bad' } } } },
      { prep: null },
      { segments: null },
    ];
    for (const override of invalid) expect(() => effectiveModel(model, override)).toThrow();
    expect(() => effectiveModel({ ...base, credits: () => 3 }, { credits: 4 })).toThrow(/function pricing/);
    expect(() => effectiveModel(base, { prep: {} })).toThrow(/no prep/);
    expect(() => effectiveModel(base, { segments: { unknown: {} } })).toThrow(/not editable/);
  });

  it('validates merged cost budgets, template placeholders and required variables without mutating defaults', () => {
    const model = tinydesk[0]!;
    expect(() => effectiveModel(model, { segments: { full: { maxCost: '6.00' } } })).toThrow(/exceeds/);
    expect(() => effectiveModel(model, { segments: { full: { promptTemplate: '{{other}}' } } })).toThrow(
      /unknown prompt/,
    );
    expect(() => effectiveModel(model, { segments: { full: { promptTemplate: '{{swaps}}' } } })).toThrow(
      /missing required/,
    );
    expect(() => effectiveModel(model, { segments: { full: { promptTemplate: 'x'.repeat(8001) } } })).toThrow(
      /8000/,
    );
    expect(() =>
      effectiveModel(model, { segments: { full: { repair: { promptTemplate: '{{targets}}' } } } }),
    ).toThrow(/missing required/);
    const changed = effectiveModel(model, {
      maxCost: '8.00',
      segments: { full: { parameters: { resolution: '1080p' }, promptTemplate: '{{swaps}}{{others}}' } },
    });
    expect(changed.effect!.segments[0]!.parameters).toMatchObject({ duration: 18, resolution: '1080p' });
    expect(model.effect!.segments[0]!.parameters.resolution).toBe('720p');
    expect(model.effect!.segments[0]!.prompt.template).toContain('Edit @video_1');
  });

  it('returns the exact admin allowlist, versions changes and keeps clears safe from stale writes', async () => {
    const model = fresh();
    const config = await getModelConfig(db, [model]);
    expect(config.models[0]).toMatchObject({
      id: model.id,
      kind: 'image',
      defaults: { enabled: true, credits: 2 },
      override: null,
      version: 0,
      placeholders: { segments: {} },
      creditsEditable: true,
    });
    expect(
      await setModelOverride(db, [model], {
        modelId: model.id,
        override: { credits: 4 },
        expectedVersion: 0,
      }),
    ).toEqual({ version: 1 });
    await expect(
      setModelOverride(db, [model], { modelId: model.id, override: { credits: 5 }, expectedVersion: 0 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await setModelOverride(db, [model], { modelId: model.id, expectedVersion: 1 }, true)).toEqual({
      version: 2,
    });
    expect(await readModelOverride(db, model.id)).toEqual({ override: null, version: 2 });
    await expect(
      setModelOverride(db, [model], { modelId: model.id, override: {}, expectedVersion: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    const outcomes = await Promise.allSettled(
      [3, 4].map((credits) =>
        setModelOverride(db, [model], { modelId: model.id, override: { credits }, expectedVersion: 2 }),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
      reason: { status: 409 },
    });
    await expect(
      setModelOverride(db, [model], { modelId: model.id, override: { credits: -1 }, expectedVersion: 3 }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('credits') });
    await expect(
      setModelOverride(db, [model], { modelId: 'missing', override: {}, expectedVersion: 0 }),
    ).rejects.toBeInstanceOf(AdminRequestError);
    await expect(
      setModelOverride(db, [model], { modelId: 'missing', override: {}, expectedVersion: 0 }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      setModelOverride(db, [model], { modelId: model.id, override: {}, expectedVersion: -1 }),
    ).rejects.toMatchObject({ status: 400 });
    const tiny = (await getModelConfig(db, tinydesk)).models[0]!;
    expect(tiny.placeholders.segments.full).toEqual({
      prompt: ['swaps', 'others'],
      repair: ['targets', 'keep'],
    });
    expect(tiny.defaults.segments!.full!.promptTemplate).toContain('{{swaps}}');
    const dynamic = (await getModelConfig(db, [{ ...model, credits: () => 3 }])).models[0]!;
    expect(dynamic.creditsEditable).toBe(false);
    expect(dynamic.defaults).not.toHaveProperty('credits');
  });

  it('snapshots price and upstream settings atomically with the debit, and refuses disabled new jobs', async () => {
    const model = fresh();
    const userId = crypto.randomUUID();
    await grantCredits(db, { userId, amount: 20, idemKey: userId, source: 'test' });
    const api = createJobs(
      {
        db,
        site: { id: 'test', url: 'https://test.example' },
        getUser: async () => ({ id: userId }),
        log: () => {},
        env: {
          GENERATION_WORKFLOW: {
            create: async () => ({}),
            get: async () => ({ status: async () => ({ status: 'running' }) }),
          },
        },
      } as unknown as Core,
      [model],
    );
    const request = () =>
      new Request('https://test.example/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ modelId: model.id, prompt: 'hello' }),
      });
    const create = async (key: string) => {
      const response = await api.create(request(), { idempotencyKey: key });
      expect(response.status).toBe(200);
      return ((await response.json()) as { job: { id: string } }).job.id;
    };
    await setModelOverride(db, [model], {
      modelId: model.id,
      override: { credits: 3, upstreamModel: 'vendor/first', maxCost: '0.50', timeoutMinutes: 20 },
      expectedVersion: 0,
    });
    const oldId = await create('old');
    await setModelOverride(db, [model], {
      modelId: model.id,
      override: { credits: 5, upstreamModel: 'vendor/second' },
      expectedVersion: 1,
    });
    const newId = await create('new');
    expect((await loadJob(db, oldId))!.costCredits).toBe(3);
    expect((await loadJob(db, newId))!.costCredits).toBe(5);
    expect((await getBalance(db, userId)).available).toBe(12);
    expect(await getModelPrices(db, [model])).toEqual([{ id: model.id, credits: 5, enabled: true }]);
    const submits: SubmitInput[] = [];
    const adapter: UpstreamAdapter = {
      name: 'yir',
      submit: async (input) => {
        submits.push(input);
        return { upstreamJobId: 'first' };
      },
      poll: async () => ({
        state: 'succeeded',
        files: [{ url: 'https://up/image.png', mediaType: 'image/png' }],
      }),
      cancel: async () => {},
    };
    await runGeneration(
      {
        db,
        models: [model],
        adapterFor: async () => adapter,
        bucket: env.OUTPUTS,
        fetcher: async () => new Response(new Uint8Array([1])),
      },
      oldId,
      { do: async (_, fn) => fn(), sleep: async () => {} },
    );
    expect(submits[0]).toMatchObject({ upstreamModel: 'vendor/first', maxCost: '0.50' });
    await setModelOverride(db, [model], {
      modelId: model.id,
      override: { enabled: false },
      expectedVersion: 2,
    });
    expect((await api.create(request())).status).toBe(400);
    expect(await create('old')).toBe(oldId);
    expect((await getBalance(db, userId)).available).toBe(12);
    expect(await db.select().from(jobs).where(eq(jobs.userId, userId))).toHaveLength(2);
  });
});
