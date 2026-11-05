import { AdminRequestError } from '@shipwords/core/admin';
import { type Db, newId } from '@shipwords/core/db/client';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { upstreamCredentials as credentials, jobs, modelOverrides } from './schema';

export interface CredentialsEnv {
  CREDENTIALS_KEY?: string;
}
export class CredentialError extends Error {
  constructor() {
    super('credential_unavailable');
    this.name = 'CredentialError';
  }
}

/** Workflow can serialize errors across a step boundary, losing their prototype. */
export function isCredentialError(error: unknown): boolean {
  if (error instanceof CredentialError) return true;
  if (!error || typeof error !== 'object') return false;
  const value = error as { name?: unknown; code?: unknown; message?: unknown };
  return (
    value.name === 'CredentialError' ||
    value.code === 'credential_unavailable' ||
    value.message === 'credential_unavailable'
  );
}

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
async function masterKey(env: CredentialsEnv) {
  try {
    const value = env.CREDENTIALS_KEY;
    if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error();
    const bytes = decode(value);
    if (bytes.length !== 32 || encode(bytes) !== value) throw new Error();
    return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch {
    throw new AdminRequestError(400, 'credentials_key_missing');
  }
}

export async function encryptCredential(env: CredentialsEnv, id: string, apiKey: string) {
  const key = await masterKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) },
    key,
    new TextEncoder().encode(apiKey),
  );
  return { keyCiphertext: encode(new Uint8Array(ciphertext)), keyIv: encode(iv), keyHint: apiKey.slice(-4) };
}

export async function decryptCredential(
  env: CredentialsEnv,
  row: { id: string; keyCiphertext: string; keyIv: string },
): Promise<string> {
  try {
    const key = await masterKey(env);
    const iv = decode(row.keyIv);
    if (iv.length !== 12) throw new Error();
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(row.id) },
      key,
      decode(row.keyCiphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new CredentialError();
  }
}

function upstream(value: unknown): string {
  if (value !== 'yir') throw new AdminRequestError(400, 'unknown upstream');
  return value;
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100)
    throw new AdminRequestError(400, 'invalid credential name');
  return value;
}
function baseUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    if (
      typeof value !== 'string' ||
      value.length > 512 ||
      value.trim() !== value ||
      !value.startsWith('https://')
    )
      throw new Error();
    const parsed = new URL(value);
    if (!parsed.hostname) throw new Error();
    return value;
  } catch {
    throw new AdminRequestError(400, 'invalid baseUrl');
  }
}
function apiKey(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.trim() !== value)
    throw new AdminRequestError(400, 'invalid apiKey');
  return value;
}
function version(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value >= Number.MAX_SAFE_INTEGER
  )
    throw new AdminRequestError(400, 'invalid expectedVersion');
  return value;
}
async function load(db: Db, id: unknown) {
  if (typeof id !== 'string') throw new AdminRequestError(404, 'credential_not_found');
  const [row] = await db.select().from(credentials).where(eq(credentials.id, id)).limit(1);
  if (!row) throw new AdminRequestError(404, 'credential_not_found');
  return row;
}

/** SQL guards share the write, closing archive/default/model-reference races. */
export function credentialAvailable(id: string, provider: string) {
  return sql`exists (select 1 from ${credentials} where ${credentials.id} = ${id} and ${credentials.upstream} = ${provider} and ${credentials.archivedAt} is null)`;
}

export async function resolveCredential(
  db: Db,
  provider: string,
  explicit?: string | null,
): Promise<string | null> {
  if (explicit) {
    const row = await load(db, explicit).catch((error) => {
      if (error instanceof AdminRequestError) throw new AdminRequestError(400, 'invalid credential');
      throw error;
    });
    if (row.archivedAt !== null || row.upstream !== provider)
      throw new AdminRequestError(400, 'invalid credential');
    return row.id;
  }
  const [row] = await db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.upstream, provider),
        eq(credentials.isDefault, true),
        isNull(credentials.archivedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** Runtime intentionally permits archived rows already pinned by jobs. */
export async function runtimeCredential(db: Db, env: CredentialsEnv, id: string, provider: string) {
  const row = await load(db, id).catch((error) => {
    if (error instanceof AdminRequestError) throw new CredentialError();
    throw error;
  });
  if (row.upstream !== provider) throw new CredentialError();
  return { apiKey: await decryptCredential(env, row), baseUrl: row.baseUrl };
}

export async function listCredentials(db: Db) {
  return {
    credentials: await db
      .select({
        id: credentials.id,
        name: credentials.name,
        upstream: credentials.upstream,
        baseUrl: credentials.baseUrl,
        keyHint: credentials.keyHint,
        isDefault: credentials.isDefault,
        archivedAt: credentials.archivedAt,
        version: credentials.version,
        createdAt: credentials.createdAt,
        updatedAt: credentials.updatedAt,
        modelCount: sql<number>`(select count(*) from ${modelOverrides} where json_extract(${modelOverrides.overrideJson}, '$.credentialId') = "upstream_credentials"."id")`,
        activeJobCount: sql<number>`(select count(*) from ${jobs} where ${jobs.credentialId} = "upstream_credentials"."id" and ${jobs.status} in ('queued', 'submitted'))`,
      })
      .from(credentials),
  };
}

export async function createCredential(db: Db, env: CredentialsEnv, params: Record<string, unknown>) {
  const id = newId('cred');
  const fields = {
    name: name(params.name),
    upstream: upstream(params.upstream),
    baseUrl: baseUrl(params.baseUrl),
  };
  const encrypted = await encryptCredential(env, id, apiKey(params.apiKey));
  const now = Date.now();
  await db
    .insert(credentials)
    .values({ id, ...fields, ...encrypted, version: 1, createdAt: now, updatedAt: now });
  return { id, version: 1 };
}

export async function updateCredential(db: Db, env: CredentialsEnv, params: Record<string, unknown>) {
  const row = await load(db, params.id);
  const expected = version(params.expectedVersion);
  const values = {
    ...(params.name !== undefined ? { name: name(params.name) } : {}),
    ...(params.baseUrl !== undefined ? { baseUrl: baseUrl(params.baseUrl) } : {}),
    ...(params.apiKey !== undefined ? await encryptCredential(env, row.id, apiKey(params.apiKey)) : {}),
    version: expected + 1,
    updatedAt: Date.now(),
  };
  const result = await db
    .update(credentials)
    .set(values)
    .where(and(eq(credentials.id, row.id), eq(credentials.version, expected)))
    .run();
  if (!result.meta.changes) throw new AdminRequestError(409, 'credential_version_conflict');
  return { version: expected + 1 };
}

export async function archiveCredential(db: Db, params: Record<string, unknown>) {
  const row = await load(db, params.id);
  const expected = version(params.expectedVersion);
  const unused = sql`not exists (select 1 from ${modelOverrides} where json_extract(${modelOverrides.overrideJson}, '$.credentialId') = ${row.id})`;
  const result = await db
    .update(credentials)
    .set({ archivedAt: Date.now(), updatedAt: Date.now(), version: expected + 1 })
    .where(
      and(
        eq(credentials.id, row.id),
        eq(credentials.version, expected),
        eq(credentials.isDefault, false),
        unused,
      ),
    )
    .run();
  if (!result.meta.changes) {
    const current = await load(db, row.id);
    throw new AdminRequestError(
      409,
      current.version !== expected ? 'credential_version_conflict' : 'credential_in_use',
    );
  }
  return { version: expected + 1 };
}

export async function setDefaultCredential(db: Db, params: Record<string, unknown>) {
  const provider = upstream(params.upstream);
  if (params.id !== null) {
    const row = await load(db, params.id);
    if (row.archivedAt !== null || row.upstream !== provider)
      throw new AdminRequestError(400, 'invalid credential');
  }
  const available = params.id === null ? sql`1` : credentialAvailable(params.id as string, provider);
  const now = Date.now();
  const results = await db.batch([
    db
      .update(credentials)
      .set({ isDefault: false, version: sql`${credentials.version} + 1`, updatedAt: now })
      .where(and(eq(credentials.upstream, provider), eq(credentials.isDefault, true), available)),
    ...(params.id === null
      ? []
      : [
          db
            .update(credentials)
            .set({ isDefault: true, version: sql`${credentials.version} + 1`, updatedAt: now })
            .where(and(eq(credentials.id, params.id as string), isNull(credentials.archivedAt))),
        ]),
  ]);
  if (params.id !== null && !results[1]?.meta.changes) throw new AdminRequestError(400, 'invalid credential');
  return {};
}
