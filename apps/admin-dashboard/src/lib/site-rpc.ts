import type {
  AdminLedgerItem,
  AdminPaymentItem,
  AdminQuotaItem,
  AdminUserListItem,
} from '@shipwords/core/admin';
import type { AdminJobItem } from '@shipwords/jobs/admin';
import { createServerFn } from '@tanstack/react-start';
import { MANAGED_SITES } from './sites';

export const ADMIN_PAGE_SIZE = 50;

export interface SiteQueryInput {
  siteId: string;
  limit?: number;
  offset?: number;
}

function validateSite(data: unknown): { siteId: string } {
  if (
    !data ||
    typeof data !== 'object' ||
    !('siteId' in data) ||
    typeof data.siteId !== 'string' ||
    !MANAGED_SITES.some((site) => site.id === data.siteId)
  ) {
    throw new Error('Unknown managed site');
  }
  return { siteId: data.siteId };
}

function validateSiteQuery(data: unknown): SiteQueryInput {
  const { siteId } = validateSite(data);
  const input: SiteQueryInput = { siteId };
  if (data && typeof data === 'object') {
    if ('limit' in data && data.limit !== undefined) {
      if (
        typeof data.limit !== 'number' ||
        !Number.isSafeInteger(data.limit) ||
        data.limit < 1 ||
        data.limit > 200
      ) {
        throw new Error('Invalid limit: must be an integer between 1 and 200');
      }
      input.limit = data.limit;
    }
    if ('offset' in data && data.offset !== undefined) {
      if (typeof data.offset !== 'number' || !Number.isSafeInteger(data.offset) || data.offset < 0) {
        throw new Error('Invalid offset: must be a non-negative integer');
      }
      input.offset = data.offset;
    }
  }
  return input;
}

async function callSiteRpc<T>(siteId: string, action: string, params?: Record<string, unknown>): Promise<T> {
  const { env: workerEnv } = await import('cloudflare:workers');
  const env = workerEnv as unknown as Record<string, Fetcher | string>;
  const site = MANAGED_SITES.find((site) => site.id === siteId);
  if (!site) throw new Error('Unknown managed site');
  const siteBindingName = site.binding;
  const binding = env[siteBindingName] as Fetcher | undefined;

  if (!binding || typeof binding.fetch !== 'function') {
    throw new Error(`Service binding "${siteBindingName}" not found or invalid`);
  }

  const secretEnvKey = ['ADMIN', 'SECRET'].join('_');
  const secretValue = env[secretEnvKey] as string | undefined;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (secretValue) {
    headers['x-admin-secret'] = secretValue;
  }

  const res = await binding.fetch('http://internal/api/admin-rpc', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, params }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'unknown error');
    let message = errorText;
    try {
      const parsed = JSON.parse(errorText);
      if (typeof parsed?.error === 'string') {
        message = parsed.error;
      } else if (typeof parsed?.error?.message === 'string') {
        message = parsed.error.message;
      } else if (typeof parsed?.message === 'string') {
        message = parsed.message;
      }
    } catch {
      // not JSON
    }
    const err = new Error(`RPC failed with status ${res.status}: ${message}`);
    (err as unknown as { status: number }).status = res.status;
    throw err;
  }

  return (await res.json()) as T;
}

async function readList<T>(
  siteId: string,
  action: string,
  key: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const response = await callSiteRpc<Record<string, unknown>>(siteId, action, params);
  if (!response || !Array.isArray(response[key])) throw new Error(`Invalid RPC response for ${action}`);
  return response[key] as T[];
}

export const getAdminUsers = createServerFn({ method: 'GET' })
  .validator(validateSiteQuery)
  .handler(({ data }) =>
    readList<AdminUserListItem>(data.siteId, 'getUsers', 'users', { limit: data.limit, offset: data.offset }),
  );

export const getAdminLedger = createServerFn({ method: 'GET' })
  .validator(validateSiteQuery)
  .handler(({ data }) =>
    readList<AdminLedgerItem>(data.siteId, 'getLedger', 'ledger', { limit: data.limit, offset: data.offset }),
  );

export const getAdminJobs = createServerFn({ method: 'GET' })
  .validator(validateSiteQuery)
  .handler(({ data }) =>
    readList<AdminJobItem>(data.siteId, 'getJobs', 'jobs', { limit: data.limit, offset: data.offset }),
  );

export const getAdminPayments = createServerFn({ method: 'GET' })
  .validator(validateSiteQuery)
  .handler(({ data }) =>
    readList<AdminPaymentItem>(data.siteId, 'getPayments', 'payments', {
      limit: data.limit,
      offset: data.offset,
    }),
  );

export const getAdminQuota = createServerFn({ method: 'GET' })
  .validator(validateSiteQuery)
  .handler(({ data }) =>
    readList<AdminQuotaItem>(data.siteId, 'getQuota', 'quota', { limit: data.limit, offset: data.offset }),
  );

export const grantCreditsRpc = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    validateSite(data);
    const payload = data as {
      siteId: string;
      userId: string;
      amount: number;
      reason: string;
      idemKey: string;
    };
    if (
      typeof payload.userId !== 'string' ||
      !payload.userId.trim() ||
      !Number.isSafeInteger(payload.amount) ||
      payload.amount <= 0 ||
      typeof payload.reason !== 'string' ||
      !payload.reason.trim() ||
      typeof payload.idemKey !== 'string' ||
      !payload.idemKey.trim()
    ) {
      throw new Error('Invalid grant credits payload');
    }
    return payload;
  })
  .handler(async ({ data }) => {
    const response = await callSiteRpc<{ success: boolean; result: { applied: boolean } }>(
      data.siteId,
      'grantCredits',
      {
        userId: data.userId,
        amount: data.amount,
        reason: data.reason,
        idemKey: data.idemKey,
      },
    );
    if (response.success !== true || typeof response.result?.applied !== 'boolean') {
      throw new Error('Invalid RPC response for grantCredits');
    }
    return response.result;
  });

export const getSiteStatus = createServerFn({ method: 'GET' })
  .validator(validateSite)
  .handler(async ({ data }) => {
    try {
      await readList<AdminUserListItem>(data.siteId, 'getUsers', 'users', { limit: 1 });
      return { status: 'online' as const };
    } catch (error) {
      return {
        status: 'offline' as const,
        error: error instanceof Error ? error.message : '站点 RPC 无响应',
      };
    }
  });

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface PrepOverride {
  upstreamModel?: string;
  maxCost?: string;
  prompt?: string;
}

export interface SegmentRepairOverride {
  upstreamModel?: string;
  maxCost?: string;
  rounds?: number;
  promptTemplate?: string;
}

export interface SegmentOverride {
  maxCost?: string;
  parameters?: Record<string, JsonValue>;
  promptTemplate?: string;
  repair?: SegmentRepairOverride;
}

export interface ModelOverride {
  enabled?: boolean;
  credits?: number;
  upstreamModel?: string;
  maxCost?: string;
  timeoutMinutes?: number;
  prep?: PrepOverride;
  segments?: Record<string, SegmentOverride>;
}

export interface SegmentPlaceholders {
  prompt: string[];
  repair?: string[];
}

export interface AdminModelConfigItem {
  id: string;
  name: string;
  kind: string;
  defaults: ModelOverride;
  override: ModelOverride | null;
  version: number;
  placeholders: {
    segments: Record<string, SegmentPlaceholders>;
  };
  creditsEditable: boolean;
}

export interface SetModelOverrideInput {
  siteId: string;
  modelId: string;
  override: ModelOverride;
  expectedVersion: number;
}

export interface ClearModelOverrideInput {
  siteId: string;
  modelId: string;
  expectedVersion: number;
}

export const getModelConfig = createServerFn({ method: 'GET' })
  .validator(validateSite)
  .handler(({ data }) => readList<AdminModelConfigItem>(data.siteId, 'getModelConfig', 'models'));

export const setModelOverride = createServerFn({ method: 'POST' })
  .validator((data: unknown): SetModelOverrideInput => {
    const { siteId } = validateSite(data);
    if (!data || typeof data !== 'object') throw new Error('Invalid payload');
    const payload = data as Partial<SetModelOverrideInput>;
    if (typeof payload.modelId !== 'string' || !payload.modelId.trim()) {
      throw new Error('modelId is required');
    }
    if (
      typeof payload.expectedVersion !== 'number' ||
      !Number.isSafeInteger(payload.expectedVersion) ||
      payload.expectedVersion < 0
    ) {
      throw new Error('expectedVersion must be a non-negative integer');
    }
    if (!payload.override || typeof payload.override !== 'object' || Array.isArray(payload.override)) {
      throw new Error('override must be an object');
    }
    return {
      siteId,
      modelId: payload.modelId.trim(),
      override: payload.override as ModelOverride,
      expectedVersion: payload.expectedVersion,
    };
  })
  .handler(async ({ data }) => {
    const response = await callSiteRpc<{ version: number }>(data.siteId, 'setModelOverride', {
      modelId: data.modelId,
      override: data.override,
      expectedVersion: data.expectedVersion,
    });
    if (typeof response?.version !== 'number') {
      throw new Error('Invalid RPC response for setModelOverride');
    }
    return response;
  });

export const clearModelOverride = createServerFn({ method: 'POST' })
  .validator((data: unknown): ClearModelOverrideInput => {
    const { siteId } = validateSite(data);
    if (!data || typeof data !== 'object') throw new Error('Invalid payload');
    const payload = data as Partial<ClearModelOverrideInput>;
    if (typeof payload.modelId !== 'string' || !payload.modelId.trim()) {
      throw new Error('modelId is required');
    }
    if (
      typeof payload.expectedVersion !== 'number' ||
      !Number.isSafeInteger(payload.expectedVersion) ||
      payload.expectedVersion < 0
    ) {
      throw new Error('expectedVersion must be a non-negative integer');
    }
    return {
      siteId,
      modelId: payload.modelId.trim(),
      expectedVersion: payload.expectedVersion,
    };
  })
  .handler(async ({ data }) => {
    const response = await callSiteRpc<{ version: number }>(data.siteId, 'clearModelOverride', {
      modelId: data.modelId,
      expectedVersion: data.expectedVersion,
    });
    if (typeof response?.version !== 'number') {
      throw new Error('Invalid RPC response for clearModelOverride');
    }
    return response;
  });
