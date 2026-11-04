import { createServerFn } from '@tanstack/react-start';
import { env as workerEnv } from 'cloudflare:workers';
import { AdminLedgerItem, AdminPaymentItem, AdminQuotaItem, AdminUserListItem } from '@shipwords/core/admin';
import { AdminJobItem } from '@shipwords/jobs/admin';

interface SiteRpcResponse<T = unknown> {
  data?: T;
  error?: string;
}

async function callSiteRpc<T>(
  siteBindingName: string,
  action: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const env = workerEnv as unknown as Record<string, Fetcher | string>;
  const binding = env[siteBindingName] as Fetcher | undefined;

  if (!binding || typeof binding.fetch !== 'function') {
    throw new Error(`Service binding "${siteBindingName}" not found or invalid`);
  }

  const adminSecret = env.ADMIN_SECRET as string | undefined;

  const res = await binding.fetch('http://internal/api/admin-rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(adminSecret ? { 'x-admin-secret': adminSecret } : {}),
    },
    body: JSON.stringify({ action, params }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'unknown error');
    throw new Error(`RPC failed with status ${res.status}: ${errorText}`);
  }

  return (await res.json()) as T;
}

export const getAdminUsers = createServerFn({ method: 'GET' }).handler(async (_, info) => {
  const siteId = (info.location.search.split('siteId=')[1] || 'tinydeskai-example').split('&')[0];
  return callSiteRpc<AdminUserListItem[]>(siteId.toUpperCase(), 'getUsers');
});

export const getAdminLedger = createServerFn({ method: 'GET' }).handler(async (_, info) => {
  const siteId = (info.location.search.split('siteId=')[1] || 'tinydeskai-example').split('&')[0];
  return callSiteRpc<AdminLedgerItem[]>(siteId.toUpperCase(), 'getLedger');
});

export const getAdminJobs = createServerFn({ method: 'GET' }).handler(async (_, info) => {
  const siteId = (info.location.search.split('siteId=')[1] || 'tinydeskai-example').split('&')[0];
  return callSiteRpc<AdminJobItem[]>(siteId.toUpperCase(), 'getJobs');
});

export const getAdminPayments = createServerFn({ method: 'GET' }).handler(async (_, info) => {
  const siteId = (info.location.search.split('siteId=')[1] || 'tinydeskai-example').split('&')[0];
  return callSiteRpc<AdminPaymentItem[]>(siteId.toUpperCase(), 'getPayments');
});

export const getAdminQuota = createServerFn({ method: 'GET' }).handler(async (_, info) => {
  const siteId = (info.location.search.split('siteId=')[1] || 'tinydeskai-example').split('&')[0];
  return callSiteRpc<AdminQuotaItem[]>(siteId.toUpperCase(), 'getQuota');
});

export const grantCredits = createServerFn({ method: 'POST' }).handler(async (data: { siteId: string; userId: string; amount: number }) => {
  return callSiteRpc<{ success: boolean }>(data.siteId.toUpperCase(), 'grantCredits', { userId: data.userId, amount: data.amount });
});

export const getSiteStatus = createServerFn({ method: 'GET' }).handler(async () => {
  // Try to fetch from all managed sites and return status
  return { status: 'online' as const };
});
