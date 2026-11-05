import { createServerFn } from '@tanstack/react-start';
import type { AdminLedgerItem, AdminPaymentItem, AdminQuotaItem, AdminUserListItem } from '@shipwords/core/admin';
import type { AdminJobItem } from '@shipwords/jobs/admin';
import { MANAGED_SITES } from './sites';

export const ADMIN_PAGE_SIZE = 50;

export interface SiteQueryInput {
  siteId: string;
  limit?: number;
  offset?: number;
}

function validateSite(data: unknown): { siteId: string } {
  if (!data || typeof data !== 'object' || !('siteId' in data) ||
      typeof data.siteId !== 'string' || !MANAGED_SITES.some((site) => site.id === data.siteId)) {
    throw new Error('Unknown managed site');
  }
  return { siteId: data.siteId };
}

function validateSiteQuery(data: unknown): SiteQueryInput {
  const { siteId } = validateSite(data);
  const input: SiteQueryInput = { siteId };
  if (data && typeof data === 'object') {
    if ('limit' in data && data.limit !== undefined) {
      if (typeof data.limit !== 'number' || !Number.isSafeInteger(data.limit) || data.limit < 1 || data.limit > 200) {
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

async function callSiteRpc<T>(
  siteId: string,
  action: string,
  params?: Record<string, unknown>,
): Promise<T> {
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
    throw new Error(`RPC failed with status ${res.status}: ${errorText}`);
  }

  return (await res.json()) as T;
}

async function readList<T>(siteId: string, action: string, key: string, params?: Record<string, unknown>): Promise<T[]> {
  const response = await callSiteRpc<Record<string, unknown>>(siteId, action, params);
  if (!response || !Array.isArray(response[key])) throw new Error(`Invalid RPC response for ${action}`);
  return response[key] as T[];
}

export const getAdminUsers = createServerFn({ method: 'GET' })
  .validator(validateSiteQuery)
  .handler(({ data }) => readList<AdminUserListItem>(data.siteId, 'getUsers', 'users', { limit: data.limit, offset: data.offset }));

export const getAdminLedger = createServerFn({ method: 'GET' })
  .validator(validateSiteQuery)
  .handler(({ data }) => readList<AdminLedgerItem>(data.siteId, 'getLedger', 'ledger', { limit: data.limit, offset: data.offset }));

export const getAdminJobs = createServerFn({ method: 'GET' })
  .validator(validateSiteQuery)
  .handler(({ data }) => readList<AdminJobItem>(data.siteId, 'getJobs', 'jobs', { limit: data.limit, offset: data.offset }));

export const getAdminPayments = createServerFn({ method: 'GET' })
  .validator(validateSiteQuery)
  .handler(({ data }) => readList<AdminPaymentItem>(data.siteId, 'getPayments', 'payments', { limit: data.limit, offset: data.offset }));

export const getAdminQuota = createServerFn({ method: 'GET' })
  .validator(validateSiteQuery)
  .handler(({ data }) => readList<AdminQuotaItem>(data.siteId, 'getQuota', 'quota', { limit: data.limit, offset: data.offset }));

export const grantCreditsRpc = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    validateSite(data);
    const payload = data as { siteId: string; userId: string; amount: number; reason: string; idemKey: string };
    if (typeof payload.userId !== 'string' || !payload.userId.trim() ||
        !Number.isSafeInteger(payload.amount) || payload.amount <= 0 ||
        typeof payload.reason !== 'string' || !payload.reason.trim() ||
        typeof payload.idemKey !== 'string' || !payload.idemKey.trim()) {
      throw new Error('Invalid grant credits payload');
    }
    return payload;
  })
  .handler(async ({ data }) => {
    const response = await callSiteRpc<{ success: boolean; result: { applied: boolean } }>(data.siteId, 'grantCredits', {
      userId: data.userId, amount: data.amount, reason: data.reason, idemKey: data.idemKey,
    });
    if (response.success !== true || typeof response.result?.applied !== 'boolean') {
      throw new Error('Invalid RPC response for grantCredits');
    }
    return response.result;
  });

export const getSiteStatus = createServerFn({ method: 'GET' }).validator(validateSite)
  .handler(async ({ data }) => {
    try {
      await readList<AdminUserListItem>(data.siteId, 'getUsers', 'users', { limit: 1 });
      return { status: 'online' as const };
    } catch (error) {
      return { status: 'offline' as const, error: error instanceof Error ? error.message : '站点 RPC 无响应' };
    }
  });
