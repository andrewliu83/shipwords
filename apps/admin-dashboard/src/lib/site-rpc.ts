import { createServerFn } from '@tanstack/react-start';
import type { AdminLedgerItem, AdminPaymentItem, AdminQuotaItem, AdminUserListItem } from '@shipwords/core/admin';
import type { AdminJobItem } from '@shipwords/jobs/admin';

async function callSiteRpc<T>(
  siteBindingName: string,
  action: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const { env: workerEnv } = await import('cloudflare:workers');
  const env = workerEnv as unknown as Record<string, Fetcher | string>;
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

export const getAdminUsers = createServerFn({ method: 'GET' }).handler(async function(_ctx) {
  const siteId = 'tinydeskai-example';
  return callSiteRpc<AdminUserListItem[]>(siteId.toUpperCase(), 'getUsers');
});

export const getAdminLedger = createServerFn({ method: 'GET' }).handler(async function(_ctx) {
  const siteId = 'tinydeskai-example';
  return callSiteRpc<AdminLedgerItem[]>(siteId.toUpperCase(), 'getLedger');
});

export const getAdminJobs = createServerFn({ method: 'GET' }).handler(async function(_ctx) {
  const siteId = 'tinydeskai-example';
  return callSiteRpc<AdminJobItem[]>(siteId.toUpperCase(), 'getJobs');
});

export const getAdminPayments = createServerFn({ method: 'GET' }).handler(async function(_ctx) {
  const siteId = 'tinydeskai-example';
  return callSiteRpc<AdminPaymentItem[]>(siteId.toUpperCase(), 'getPayments');
});

export const getAdminQuota = createServerFn({ method: 'GET' }).handler(async function(_ctx) {
  const siteId = 'tinydeskai-example';
  return callSiteRpc<AdminQuotaItem[]>(siteId.toUpperCase(), 'getQuota');
});

export const grantCreditsRpc = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const payload = data as { siteId: string; userId: string; amount: number };
    if (!payload.siteId || !payload.userId || typeof payload.amount !== 'number') {
      throw new Error('Invalid grant credits payload');
    }
    return payload;
  })
  .handler(async ({ data }) => {
    return callSiteRpc<{ success: boolean }>(data.siteId.toUpperCase(), 'grantCredits', { userId: data.userId, amount: data.amount });
  });

export const getSiteStatus = createServerFn({ method: 'GET' }).handler(async function(_ctx) {
  return { status: 'online' as const };
});
