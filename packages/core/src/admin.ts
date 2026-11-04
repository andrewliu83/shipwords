import { desc, eq, sql } from 'drizzle-orm';
import { grantCredits } from './credits/ledger';
import type { Db } from './db/client';
import { creditAccounts, creditLedger, creditLots, orders, payments, quotaCounters, user, userAttribution } from './db/schema';
import { errorResponse, json } from './http';

export interface AdminUserListItem {
  id: string;
  email: string;
  name: string;
  createdAt: number;
  balance: number;
  debt: number;
  attribution?: {
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    referrer: string | null;
    landingPath: string | null;
  } | null;
}

export interface AdminLedgerItem {
  id: string;
  userId: string;
  userEmail?: string | null;
  kind: 'grant' | 'spend' | 'refund' | 'revoke';
  delta: number;
  debtDelta: number;
  idemKey: string;
  ref: string | null;
  createdAt: number;
}

export interface AdminPaymentItem {
  id: string;
  userId: string;
  userEmail?: string | null;
  provider: string;
  paymentRef: string;
  amount: number;
  currency: string;
  amountRefunded: number;
  creditsGranted: number;
  createdAt: number;
}

export interface AdminQuotaItem {
  key: string;
  window: string;
  count: number;
}

/**
 * 校验 Admin 请求身份
 * 支持：
 * 1. env.ADMIN_SECRET 匹配 Header `x-admin-secret`
 * 2. 或者直接放行（由外层 Worker 的 Service Bindings 保证只有 Admin Worker 能调用）
 */
export function checkAdminAuth(request: Request, adminSecret?: string): Response | null {
  if (!adminSecret) return null; // 未配置密钥时默认信任（Service Bindings 环境内）
  const header = request.headers.get('x-admin-secret');
  if (header !== adminSecret) {
    return errorResponse(403, 'forbidden');
  }
  return null;
}

/**
 * 获取用户列表（包含余额、归因）
 */
export async function getAdminUsers(db: Db, limit = 50, offset = 0): Promise<AdminUserListItem[]> {
  const users = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      debt: creditAccounts.debt,
    })
    .from(user)
    .leftJoin(creditAccounts, eq(user.id, creditAccounts.userId))
    .orderBy(desc(user.createdAt))
    .limit(limit)
    .offset(offset);

  // 批量查归因
  const userIds = users.map((u) => u.id);
  const attributions = userIds.length
    ? await db
        .select()
        .from(userAttribution)
        .where(sql`${userAttribution.userId} IN ${userIds}`)
    : [];
  const attrMap = new Map(attributions.map((a) => [a.userId, a]));

  // 查每个用户的可用余额（未过期的 remaining 之和）
  const now = Date.now();
  const balances = userIds.length
    ? await db
        .select({
          userId: creditLots.userId,
          total: sql<number>`sum(${creditLots.remaining})`,
        })
        .from(creditLots)
        .where(sql`${creditLots.userId} IN ${userIds} and (${creditLots.expiresAt} is null or ${creditLots.expiresAt} > ${now})`)
        .groupBy(creditLots.userId)
    : [];
  const balanceMap = new Map(balances.map((b) => [b.userId, Number(b.total ?? 0)]));

  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    createdAt: u.createdAt instanceof Date ? u.createdAt.getTime() : Number(u.createdAt),
    debt: u.debt ?? 0,
    balance: (balanceMap.get(u.id) ?? 0) - (u.debt ?? 0),
    attribution: attrMap.get(u.id)
      ? {
          utmSource: attrMap.get(u.id)!.utmSource,
          utmMedium: attrMap.get(u.id)!.utmMedium,
          utmCampaign: attrMap.get(u.id)!.utmCampaign,
          referrer: attrMap.get(u.id)!.referrer,
          landingPath: attrMap.get(u.id)!.landingPath,
        }
      : null,
  }));
}

/**
 * 获取积分账本明细
 */
export async function getAdminLedger(db: Db, limit = 50, offset = 0): Promise<AdminLedgerItem[]> {
  const records = await db
    .select({
      id: creditLedger.id,
      userId: creditLedger.userId,
      userEmail: user.email,
      kind: creditLedger.kind,
      delta: creditLedger.delta,
      debtDelta: creditLedger.debtDelta,
      idemKey: creditLedger.idemKey,
      ref: creditLedger.ref,
      createdAt: creditLedger.createdAt,
    })
    .from(creditLedger)
    .leftJoin(user, eq(creditLedger.userId, user.id))
    .orderBy(desc(creditLedger.createdAt))
    .limit(limit)
    .offset(offset);

  return records.map((r) => ({
    ...r,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Number(r.createdAt),
  }));
}

/**
 * 获取支付记录
 */
export async function getAdminPayments(db: Db, limit = 50, offset = 0): Promise<AdminPaymentItem[]> {
  const records = await db
    .select({
      id: payments.id,
      userId: payments.userId,
      userEmail: user.email,
      provider: payments.provider,
      paymentRef: payments.paymentRef,
      amount: payments.amount,
      currency: payments.currency,
      amountRefunded: payments.amountRefunded,
      creditsGranted: payments.creditsGranted,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .leftJoin(user, eq(payments.userId, user.id))
    .orderBy(desc(payments.createdAt))
    .limit(limit)
    .offset(offset);

  return records.map((r) => ({
    ...r,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Number(r.createdAt),
  }));
}

/**
 * 获取访客配额计数
 */
export async function getAdminQuota(db: Db, limit = 50, offset = 0): Promise<AdminQuotaItem[]> {
  return db
    .select()
    .from(quotaCounters)
    .orderBy(desc(quotaCounters.count))
    .limit(limit)
    .offset(offset);
}

/**
 * 手动为用户充值积分
 */
export async function handleAdminGrantCredits(
  db: Db,
  params: {
    userId: string;
    amount: number;
    reason: string;
    adminId?: string;
  },
) {
  if (params.amount <= 0) {
    throw new Error('amount must be positive');
  }

  const idemKey = `admin-grant:${params.userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  return grantCredits(db, {
    userId: params.userId,
    amount: params.amount,
    source: 'admin',
    sourceRef: params.reason,
    idemKey,
    // 管理员充值不过期
    expiresAt: null,
  });
}
