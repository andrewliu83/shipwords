import type { AdminUserListItem } from '@shipwords/core/admin';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { getAdminUsers, grantCreditsRpc } from '~/lib/site-rpc.server';
import { MANAGED_SITES } from '~/lib/sites';

interface SearchParams {
  siteId?: string;
}

export const Route = createFileRoute('/users')({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    siteId: (search.siteId as string) || MANAGED_SITES[0]?.id,
  }),
  loaderDeps: ({ search }) => ({ siteId: search.siteId }),
  loader: async ({ deps }) => {
    const activeSite = MANAGED_SITES.find((s) => s.id === deps.siteId) || MANAGED_SITES[0];
    if (!activeSite) return { users: [], activeSite: null, error: '未找到配置的站点' };

    try {
      const users = await getAdminUsers();
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

  const [selectedUser, setSelectedUser] = useState<AdminUserListItem | null>(null);
  const [grantAmount, setGrantAmount] = useState<number>(100);
  const [grantReason, setGrantReason] = useState<string>('运营补偿');
  const [submitting, setSubmitting] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !activeSite) return;
    setSubmitting(true);
    setActionMsg(null);

    try {
      await grantCreditsRpc({
        siteId: activeSite.id,
        userId: selectedUser.id,
        amount: Number(grantAmount),
      });
      setActionMsg({ text: `成功向 ${selectedUser.email} 充值 ${grantAmount} 积分！`, ok: true });
      setTimeout(() => {
        setSelectedUser(null);
        // 刷新页面
        window.location.reload();
      }, 1200);
    } catch (err: unknown) {
      setActionMsg({
        text: err instanceof Error ? err.message : '充值失败',
        ok: false,
      });
    } finally {
      setSubmitting(false);
    }
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
          <label htmlFor="site-select" className="text-xs text-slate-400">选择站点:</label>
          <select
            id="site-select"
            value={search.siteId}
            onChange={(e) => navigate({ search: { siteId: e.target.value } })}
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
                    <td className="py-3 px-4 font-mono font-medium text-indigo-400">
                      {u.balance}
                    </td>
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
                        onClick={() => setSelectedUser(u)}
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

      {/* 充值积分模态弹窗 */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">补发积分</h3>
            <p className="text-xs text-slate-400 mt-1">
              向目标用户账号注入额度，此操作不可撤销，请谨慎操作。
            </p>

            <form onSubmit={handleGrant} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400">目标用户</label>
                <div className="mt-1 text-sm text-slate-200 font-mono bg-slate-950 px-3 py-2 rounded border border-slate-800">
                  {selectedUser.email}
                </div>
              </div>

              <div>
                <label htmlFor="grant-amount" className="block text-xs font-medium text-slate-400">充值数量 (积分)</label>
                <input
                  id="grant-amount"
                  type="number"
                  min="1"
                  required
                  value={grantAmount}
                  onChange={(e) => setGrantAmount(Number(e.target.value))}
                  className="mt-1 block w-full bg-slate-950 border border-slate-700 text-sm text-white rounded px-3 py-2 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="grant-reason" className="block text-xs font-medium text-slate-400">发发事由 / 备注</label>
                <input
                  id="grant-reason"
                  type="text"
                  required
                  value={grantReason}
                  onChange={(e) => setGrantReason(e.target.value)}
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
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded transition-colors disabled:opacity-50"
                >
                  {submitting ? '提交中...' : '确认充值'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
