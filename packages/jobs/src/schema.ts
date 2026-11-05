import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

/**
 * Generation jobs. State only moves forward: queued → submitted → succeeded | failed | canceled;
 * every state change is a conditional UPDATE, so a finished job can never be moved to another state.
 */
export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    /** Signed-in users' jobs have userId; guest jobs only have guestId, and userId is filled in when claimed after sign-in. */
    userId: text('user_id'),
    guestId: text('guest_id'),
    modelId: text('model_id').notNull(),
    kind: text('kind', { enum: ['image', 'video', 'music'] }).notNull(),
    prompt: text('prompt').notNull(),
    inputJson: text('input_json').notNull(),
    overrideJson: text('override_json'),
    credentialId: text('credential_id'),
    costCredits: integer('cost_credits').notNull().default(0),
    /** Guest quota counting rule, used to return quota on failure. */
    quotaJson: text('quota_json'),
    quotaReleased: integer('quota_released', { mode: 'boolean' }).notNull().default(false),
    status: text('status', { enum: ['queued', 'submitted', 'succeeded', 'failed', 'canceled'] })
      .notNull()
      .default('queued'),
    upstream: text('upstream').notNull(),
    upstreamJobId: text('upstream_job_id'),
    /** What the upstream actually charged (USD string), summed over every upstream task; null until read or when the upstream doesn't report it. */
    upstreamCostUsd: text('upstream_cost_usd'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    /** R2 key and content type of the output. */
    outputsJson: text('outputs_json'),
    createdAt: integer('created_at', { mode: 'number' }).notNull().default(now),
    submittedAt: integer('submitted_at', { mode: 'number' }),
    finishedAt: integer('finished_at', { mode: 'number' }),
  },
  (t) => [
    index('jobs_user_idx').on(t.userId, t.createdAt),
    index('jobs_guest_idx').on(t.guestId, t.createdAt),
  ],
);

export type JobRow = typeof jobs.$inferSelect;
export type JobStatus = JobRow['status'];
export const TERMINAL: readonly JobStatus[] = ['succeeded', 'failed', 'canceled'];

export const modelOverrides = sqliteTable('model_overrides', {
  modelId: text('model_id').primaryKey(),
  overrideJson: text('override_json').notNull(),
  version: integer('version').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const upstreamCredentials = sqliteTable(
  'upstream_credentials',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    upstream: text('upstream').notNull(),
    baseUrl: text('base_url'),
    keyCiphertext: text('key_ciphertext').notNull(),
    keyIv: text('key_iv').notNull(),
    keyHint: text('key_hint').notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    version: integer('version').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    archivedAt: integer('archived_at'),
  },
  (t) => [uniqueIndex('upstream_credentials_default_idx').on(t.upstream).where(sql`${t.isDefault} = 1`)],
);
