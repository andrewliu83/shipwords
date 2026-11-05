import { AdminRequestError } from '@shipwords/core/admin';
import type { Db } from '@shipwords/core/db/client';
import { and, eq } from 'drizzle-orm';
import { creditsFor, type ModelDefinition, promptPlaceholders, usdMicros, validateModel } from './models';
import { modelOverrides } from './schema';

export type ModelOverride = {
  enabled?: boolean;
  credits?: number;
  upstreamModel?: string;
  maxCost?: string;
  timeoutMinutes?: number;
  prep?: { upstreamModel?: string; maxCost?: string; prompt?: string };
  segments?: Record<
    string,
    {
      maxCost?: string;
      parameters?: Record<string, unknown>;
      promptTemplate?: string;
      repair?: { upstreamModel?: string; maxCost?: string; rounds?: number; promptTemplate?: string };
    }
  >;
};

function object(
  value: unknown,
  allowed: readonly string[],
  where: string,
  fields = true,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${where} must be an object`);
  for (const [key, field] of Object.entries(value)) {
    if (!allowed.includes(key)) throw new Error(`${where}: field ${key} is not editable`);
    if (field === undefined || field === null) throw new Error(`${where}.${key} must have a value`);
    if (!fields) continue;
    if (['upstreamModel', 'prompt', 'promptTemplate', 'maxCost'].includes(key) && typeof field !== 'string')
      throw new Error(`${where}.${key} must be a string`);
    if (key === 'upstreamModel' && !(field as string).trim())
      throw new Error(`${where}.${key} must be nonempty`);
    if (key === 'maxCost') usdMicros(field);
    if (key === 'prompt' && (field as string).length > 8000)
      throw new Error(`${where}.prompt exceeds 8000 characters`);
    if (key === 'parameters' && (!field || typeof field !== 'object' || Array.isArray(field)))
      throw new Error(`${where}.parameters must be an object`);
  }
  return value as Record<string, unknown>;
}

/** Merge only explicitly editable fields; functions and asset/check configuration always come from code. */
export function effectiveModel(code: ModelDefinition, value: unknown): ModelDefinition {
  if (value === null || value === undefined) {
    validateModel(code);
    return code;
  }
  const raw = object(
    value,
    ['enabled', 'credits', 'upstreamModel', 'maxCost', 'timeoutMinutes', 'prep', 'segments'],
    'override',
  );
  const override = raw as ModelOverride;
  if ('enabled' in raw && typeof override.enabled !== 'boolean') throw new Error('enabled must be boolean');
  if (
    'credits' in raw &&
    (typeof code.credits === 'function' || !Number.isSafeInteger(override.credits) || override.credits! < 0)
  )
    throw new Error('credits must be a nonnegative safe integer and cannot override function pricing');
  if (
    'timeoutMinutes' in raw &&
    (typeof override.timeoutMinutes !== 'number' ||
      !Number.isFinite(override.timeoutMinutes) ||
      override.timeoutMinutes <= 0)
  )
    throw new Error('timeoutMinutes must be positive');
  const { prep, segments, ...top } = override;
  const model: ModelDefinition = { ...code, ...top };
  if ('prep' in raw) {
    object(prep, ['upstreamModel', 'maxCost', 'prompt'], 'prep');
    if (!code.effect?.prep) throw new Error('model has no prep');
  }
  if ('segments' in raw) {
    object(segments, code.effect?.segments.map((segment) => segment.id) ?? [], 'segments', false);
    for (const [id, segment] of Object.entries(segments!)) {
      object(segment, ['maxCost', 'parameters', 'promptTemplate', 'repair'], `segments.${id}`);
      if ('repair' in segment) {
        object(
          segment.repair,
          ['upstreamModel', 'maxCost', 'rounds', 'promptTemplate'],
          `segments.${id}.repair`,
        );
        if (!code.effect?.segments.find((entry) => entry.id === id)?.repair)
          throw new Error(`segment ${id} has no repair`);
      }
    }
  }
  if (code.effect) {
    const { prompt, ...prepFields } = prep ?? {};
    model.effect = {
      ...code.effect,
      slots: code.effect.slots.map((slot) => ({
        ...slot,
        ...(prompt !== undefined ? { prep: prompt } : {}),
      })),
      prep: code.effect.prep ? { ...code.effect.prep, ...prepFields } : undefined,
      segments: code.effect.segments.map((segment) => {
        const { promptTemplate, repair, ...fields } = segments?.[segment.id] ?? {};
        const { promptTemplate: repairTemplate, ...repairFields } = repair ?? {};
        return {
          ...segment,
          ...fields,
          parameters: { ...segment.parameters, ...fields.parameters },
          prompt: {
            ...segment.prompt,
            ...(promptTemplate !== undefined ? { template: promptTemplate } : {}),
          },
          repair: segment.repair
            ? {
                ...segment.repair,
                ...repairFields,
                prompt: {
                  ...segment.repair.prompt,
                  ...(repairTemplate !== undefined ? { template: repairTemplate } : {}),
                },
              }
            : undefined,
        };
      }),
    };
  }
  validateModel(model);
  return model;
}

export function modelForJob(
  models: readonly ModelDefinition[],
  job: { modelId: string; overrideJson?: string | null },
) {
  const code = models.find((model) => model.id === job.modelId);
  return code ? effectiveModel(code, job.overrideJson ? JSON.parse(job.overrideJson) : null) : undefined;
}

export async function readModelOverride(db: Db, modelId: string) {
  const [row] = await db.select().from(modelOverrides).where(eq(modelOverrides.modelId, modelId)).limit(1);
  return {
    override: row ? (JSON.parse(row.overrideJson) as ModelOverride) : null,
    version: row?.version ?? 0,
  };
}

export async function getModelConfig(db: Db, models: readonly ModelDefinition[]) {
  return {
    models: await Promise.all(
      models.map(async (model) => {
        const { override, version } = await readModelOverride(db, model.id);
        const defaults: ModelOverride = {
          enabled: model.enabled !== false,
          ...(typeof model.credits === 'number' ? { credits: model.credits } : {}),
          upstreamModel: model.upstreamModel,
          maxCost: model.maxCost,
          timeoutMinutes: model.timeoutMinutes,
          ...(model.effect?.prep
            ? {
                prep: {
                  upstreamModel: model.effect.prep.upstreamModel,
                  maxCost: model.effect.prep.maxCost,
                  prompt: model.effect.slots.find((slot) => slot.prep)?.prep,
                },
              }
            : {}),
          ...(model.effect
            ? {
                segments: Object.fromEntries(
                  model.effect.segments.map((segment) => [
                    segment.id,
                    {
                      maxCost: segment.maxCost,
                      parameters: segment.parameters,
                      promptTemplate: segment.prompt.template,
                      ...(segment.repair
                        ? {
                            repair: {
                              upstreamModel: segment.repair.upstreamModel,
                              maxCost: segment.repair.maxCost,
                              rounds: segment.repair.rounds,
                              promptTemplate: segment.repair.prompt.template,
                            },
                          }
                        : {}),
                    },
                  ]),
                ),
              }
            : {}),
        };
        return {
          id: model.id,
          name: model.name,
          kind: model.kind,
          defaults,
          override,
          version,
          placeholders: {
            segments: Object.fromEntries(
              (model.effect?.segments ?? []).map((segment) => {
                const args = Array.from({ length: (1 << segment.slots.length) - 1 }, (_, i) =>
                  segment.slots.filter((_, bit) => (i + 1) & (1 << bit)),
                );
                return [
                  segment.id,
                  {
                    prompt: promptPlaceholders(
                      segment.prompt,
                      args.map((slots) =>
                        Object.fromEntries(slots.map((slot, i) => [slot, `@image${i + 1}`])),
                      ),
                    ),
                    ...(segment.repair ? { repair: promptPlaceholders(segment.repair.prompt, args) } : {}),
                  },
                ];
              }),
            ),
          },
          creditsEditable: typeof model.credits === 'number',
        };
      }),
    ),
  };
}

export async function setModelOverride(
  db: Db,
  models: readonly ModelDefinition[],
  params: Record<string, unknown>,
  clear = false,
) {
  const code = models.find((model) => model.id === params.modelId);
  if (!code) throw new AdminRequestError(404, 'unknown model');
  const expected = params.expectedVersion;
  if (
    typeof expected !== 'number' ||
    !Number.isSafeInteger(expected) ||
    expected < 0 ||
    expected >= Number.MAX_SAFE_INTEGER
  )
    throw new AdminRequestError(400, 'expectedVersion must be a nonnegative safe integer');
  const override = clear ? null : params.override;
  try {
    if (!clear && (override === null || override === undefined))
      throw new Error('override must be an object');
    effectiveModel(code, override);
  } catch (error) {
    throw new AdminRequestError(400, error instanceof Error ? error.message : String(error));
  }
  const values = { overrideJson: JSON.stringify(override), version: expected + 1, updatedAt: Date.now() };
  // Keep a tombstone on clear: resetting the version would permit stale writers after a clear (ABA).
  const result =
    expected === 0
      ? await db
          .insert(modelOverrides)
          .values({ modelId: code.id, ...values })
          .onConflictDoNothing()
          .run()
      : await db
          .update(modelOverrides)
          .set(values)
          .where(and(eq(modelOverrides.modelId, code.id), eq(modelOverrides.version, expected)))
          .run();
  if (!result.meta.changes) throw new AdminRequestError(409, 'model configuration version conflict');
  return { version: expected + 1 };
}

export async function getModelPrices(db: Db, models: readonly ModelDefinition[]) {
  return Promise.all(
    models.map(async (code) => {
      const { override } = await readModelOverride(db, code.id);
      const model = effectiveModel(code, override);
      return { id: model.id, credits: creditsFor(model, {}), enabled: model.enabled !== false };
    }),
  );
}
