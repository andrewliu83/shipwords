import type { AdminUserListItem } from '@shipwords/core/admin';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { getAdminUsers, grantCreditsRpc } from '~/lib/site-rpc';
import { MANAGED_SITES, resolveSiteId } from '~/lib/sites';

interface SearchParams {
  siteId?: string;
  offset?: number;
}

const pageSize = 50;

function parseOffset(value: unknown): number {
  const offset = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= Number.MAX_SAFE_INTEGER - pageSize
    ? offset
    : 0;
}

interface PendingGrant {
  siteId: string;
  userId: string;
  amount: number;
  reason: string;
  idemKey: string;
}

const pendingGrantStorageKey = 'admin-dashboard.pending-grant.v1';

function readPendingGrant(): PendingGrant | null {
  const stored = localStorage.getItem(pendingGrantStorageKey);
  if (stored === null) return null;
  const value = JSON.parse(stored) as PendingGrant;
  if (
    !value ||
    typeof value.siteId !== 'string' ||
    typeof value.userId !== 'string' ||
    !Number.isSafeInteger(value.amount) ||
    value.amount <= 0 ||
    typeof value.reason !== 'string' ||
    !value.reason.trim() ||
    typeof value.idemKey !== 'string' ||
    !value.idemKey
  ) {
    throw new Error('无法读取未确认的补发记录，请先核对账本；为避免重复补发，已阻止新操作。');
  }
  return value;
}

export const Route = createFileRoute('/users')({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    siteId: resolveSiteId(search.siteId),
    offset: parseOffset(search.offset),
  }),
  loaderDeps: ({ search }) => ({ siteId: search.siteId, offset: search.offset ?? 0 }),
  loader: async ({ deps }) => {
    const activeSite = MANAGED_SITES.find((s) => s.id === deps.siteId) || MANAGED_SITES[0];
    if (!activeSite) return { users: [], activeSite: null, error: '未找到配置的站点' };

    try {
      const users = await getAdminUsers({
        data: { siteId: activeSite.id, limit: pageSize, offset: deps.offset },
      });
      return { users, activeSite, error: null };
    } catch (err: unknown) {
      return {
        users: [],
        activeSite,
        error: err instanceof Error ? err.message : '获取用户失败',
      };
    }
  },
  component: UsersPage,
});

function UsersPage() {
  const { users, activeSite, error } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const offset = search.offset ?? 0;

  const [selectedUser, setSelectedUser] = useState<AdminUserListItem | null>(null);
  const [grantAmount, setGrantAmount] = useState<number>(100);
  const [grantReason, setGrantReason] = useState<string>('运营补偿');
  const [submitting, setSubmitting] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pendingGrant, setPendingGrant] = useState<PendingGrant | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    try {
      setPendingGrant(readPendingGrant());
      setStorageReady(true);
    } catch {
      setStorageError('无法读取补发记录，请检查浏览器存储并核对账本；已阻止新操作。');
    }
  }, []);

  const submitGrant = async (retry?: PendingGrant) => {
    if (inFlight.current || !storageReady || storageError) return;
    if (!retry && (!selectedUser || !activeSite)) return;
    inFlight.current = true;
    setSubmitting(true);
    setActionMsg(null);
    try {
      const existing = readPendingGrant();
      if (existing && (!retry || retry.idemKey !== existing.idemKey)) {
        setPendingGrant(existing);
        throw new Error('存在结果未确认的补发，请先重试原操作确认结果，再发起新操作。');
      }
      const operation = existing ??
        retry ?? {
          siteId: activeSite!.id,
          userId: selectedUser!.id,
          amount: grantAmount,
          reason: grantReason,
          idemKey: crypto.randomUUID(),
        };
      if (!Number.isSafeInteger(operation.amount) || operation.amount <= 0 || !operation.reason.trim()) {
        throw new Error('请输入正安全整数积分数量和补发原因。');
      }
      // Persist the complete immutable request before any network call.
      localStorage.setItem(pendingGrantStorageKey, JSON.stringify(operation));
      setPendingGrant(operation);
      const result = await grantCreditsRpc({ data: operation });
      localStorage.removeItem(pendingGrantStorageKey);
      setPendingGrant(null);
      setActionMsg({
        text: result.applied ? '补发成功，结果已确认。' : '原操作已处理，结果已确认，未重复补发积分。',
        ok: true,
      });
      setSelectedUser(null);
      await navigate({ to: '/users', search: { siteId: operation.siteId } });
    } catch (err: unknown) {
      setActionMsg({
        text: `${err instanceof Error ? err.message : '请求失败'} 请勿重新补发；若请求已发送，请使用原操作重试确认结果。`,
        ok: false,
      });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitGrant(pendingGrant ?? undefined);
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">用户管理</h1>
          <p className="text-sm text-slate-400 mt-1">查看用户注册时间、剩余可用积分及注册来源归因</p>
        </div>

        {/* 站点切换下拉 */}
        <div className="flex items-center gap-2">
          <label htmlFor="site-select" className="text-xs text-slate-400">
            选择站点:
          </label>
          <select
            id="site-select"
            value={search.siteId}
            disabled={submitting}
            onChange={(e) => {
              setSelectedUser(null);
              navigate({ search: { siteId: e.target.value, offset: 0 } });
            }}
            className="bg-slate-900 border border-slate-700 text-sm text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
          >
            {MANAGED_SITES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 text-sm">
          {error}
        </div>
      )}

      {storageError && <p role="alert">{storageError}</p>}
      {actionMsg && <p role="status">{actionMsg.text}</p>}
      {pendingGrant && (
        <div role="alert">
          <p>
            存在结果未确认的补发：站点 {pendingGrant.siteId}，用户 {pendingGrant.userId}，
            {pendingGrant.amount} 积分，原因：{pendingGrant.reason}。
          </p>
          <p>
            刷新或关闭弹窗不会撤销请求。确认结果前不能更改参数或发起新补发；重试只确认原操作，不会重复发放。
          </p>
          <button
            type="button"
            disabled={submitting || !!storageError}
            onClick={() => submitGrant(pendingGrant)}
          >
            {submitting ? '确认中…' : '重试原操作并确认结果'}
          </button>
        </div>
      )}

      {/* 用户表格 */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">邮箱 / 昵称</th>
                <th className="py-3 px-4">积分余额</th>
                <th className="py-3 px-4">欠额</th>
                <th className="py-3 px-4">注册归因</th>
                <th className="py-3 px-4">注册时间</th>
                <th className="py-3 px-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    暂无用户数据
                  </td>
                </tr>
              ) : (
                users.map((u: AdminUserListItem) => (
                  <tr key={u.id} className="hover:bg-slate-850/30 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-medium text-white">{u.email}</div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">{u.name || u.id}</div>
                    </td>
                    <td className="py-3 px-4 font-mono font-medium text-indigo-400">{u.balance}</td>
                    <td className="py-3 px-4 font-mono text-slate-400">
                      {u.debt > 0 ? <span className="text-rose-400">-{u.debt}</span> : '0'}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-400 max-w-[200px] truncate">
                      {u.attribution ? (
                        <span>
                          {u.attribution.utmSource || '直接访问'}
                          {u.attribution.landingPath && ` (${u.attribution.landingPath})`}
                        </span>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-400 font-mono whitespace-nowrap">
                      {new Date(u.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        disabled={!storageReady || !!storageError || !!pendingGrant || submitting}
                        onClick={() => {
                          setSelectedUser(u);
                          setActionMsg(null);
                        }}
                        className="px-2.5 py-1 text-xs font-medium bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 rounded transition-colors"
                      >
                        补发积分
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <nav
        aria-label="用户列表分页"
        className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400"
      >
        <span>
          第 {Math.floor(offset / pageSize) + 1} 页 · 每页 {pageSize} 条 · 本页 {users.length} 条
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={offset === 0 || submitting}
            onClick={() => {
              setSelectedUser(null);
              navigate({ search: { siteId: search.siteId, offset: Math.max(0, offset - pageSize) } });
            }}
            className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            上一页
          </button>
          <button
            type="button"
            disabled={
              !!error ||
              users.length < pageSize ||
              submitting ||
              offset > Number.MAX_SAFE_INTEGER - 2 * pageSize
            }
            onClick={() => {
              setSelectedUser(null);
              navigate({ search: { siteId: search.siteId, offset: offset + pageSize } });
            }}
            className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            下一页
          </button>
        </div>
      </nav>

      {/* 充值积分模态弹窗 */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">补发积分</h3>
            <p className="text-xs text-slate-400 mt-1">
              向目标用户账号注入额度，此操作不可撤销，请谨慎操作。
            </p>
            {pendingGrant && (
              <p role="alert">
                原补发结果尚未确认，参数已锁定。关闭弹窗或刷新不会取消操作；请重试原操作确认结果，再修改参数发起下一笔补发。
              </p>
            )}

            <form onSubmit={handleGrant} className="mt-4 space-y-4">
              <div>
                <span className="block text-xs font-medium text-slate-400">目标用户</span>
                <div className="mt-1 text-sm text-slate-200 font-mono bg-slate-950 px-3 py-2 rounded border border-slate-800">
                  {selectedUser.email}
                </div>
              </div>

              <div>
                <label htmlFor="grant-amount" className="block text-xs font-medium text-slate-400">
                  充值数量 (积分)
                </label>
                <input
                  id="grant-amount"
                  type="number"
                  min="1"
                  required
                  value={grantAmount}
                  disabled={submitting || !!pendingGrant}
                  onChange={(e) => {
                    setGrantAmount(Number(e.target.value));
                    setActionMsg(null);
                  }}
                  className="mt-1 block w-full bg-slate-950 border border-slate-700 text-sm text-white rounded px-3 py-2 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="grant-reason" className="block text-xs font-medium text-slate-400">
                  发发事由 / 备注
                </label>
                <input
                  id="grant-reason"
                  type="text"
                  required
                  value={grantReason}
                  disabled={submitting || !!pendingGrant}
                  onChange={(e) => {
                    setGrantReason(e.target.value);
                    setActionMsg(null);
                  }}
                  className="mt-1 block w-full bg-slate-950 border border-slate-700 text-sm text-white rounded px-3 py-2 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {actionMsg && (
                <div
                  className={`p-3 rounded text-xs ${
                    actionMsg.ok
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                  }`}
                >
                  {actionMsg.text}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  disabled={submitting || actionMsg?.ok}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting || !storageReady || !!storageError}
                  className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded transition-colors disabled:opacity-50"
                >
                  {submitting ? '提交中...' : pendingGrant ? '重试原操作并确认结果' : '确认充值'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
