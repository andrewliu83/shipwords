import type { AdminQuotaItem } from '@shipwords/core/admin';
import { createFileRoute } from '@tanstack/react-router';
import { ADMIN_PAGE_SIZE, getAdminQuota } from '~/lib/site-rpc';
import { MANAGED_SITES, resolveSiteId } from '~/lib/sites';

interface SearchParams {
  siteId?: string;
  offset?: number;
}

function parseOffset(value: unknown): number {
  const offset = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= Number.MAX_SAFE_INTEGER - ADMIN_PAGE_SIZE
    ? offset : 0;
}

export const Route = createFileRoute('/quota')({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    siteId: resolveSiteId(search.siteId),
    offset: parseOffset(search.offset),
  }),
  loaderDeps: ({ search }) => ({
    siteId: search.siteId,
    offset: search.offset ?? 0,
  }),
  loader: async ({ deps }) => {
    const activeSite = MANAGED_SITES.find((s) => s.id === deps.siteId) || MANAGED_SITES[0];
    if (!activeSite) return { quota: [], activeSite: null, error: '未找到配置的站点', offset: deps.offset };

    try {
      const quota = await getAdminQuota({
        data: { siteId: activeSite.id, limit: ADMIN_PAGE_SIZE, offset: deps.offset },
      });
      return { quota, activeSite, error: null, offset: deps.offset };
    } catch (err: unknown) {
      return {
        quota: [],
        activeSite,
        error: err instanceof Error ? err.message : '获取配额记录失败',
        offset: deps.offset,
      };
    }
  },
  component: QuotaPage,
});

function QuotaPage() {
  const { quota, error, offset } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">访客配额监控</h1>
          <p className="text-sm text-slate-400 mt-1">未登录访客免费试用次数统计与时间窗口监控</p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="quota-site-select" className="text-xs text-slate-400">选择站点:</label>
          <select
            id="quota-site-select"
            value={search.siteId}
            onChange={(e) => navigate({ search: { siteId: e.target.value, offset: 0 } })}
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

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">配额键 (设备 / IP 标识)</th>
                <th className="py-3 px-4">时间窗口</th>
                <th className="py-3 px-4 text-right">已消耗次数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {quota.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-slate-500">
                    暂无配额计数记录
                  </td>
                </tr>
              ) : (
                quota.map((q: AdminQuotaItem) => (
                  <tr key={`${q.key}-${q.window}`} className="hover:bg-slate-850/30 transition-colors">
                    <td className="py-3 px-4 font-mono text-xs text-white">
                      {q.key}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-400">
                      {q.window}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium text-amber-400 text-right">
                      {q.count}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 bg-slate-900/60 text-sm text-slate-400">
          <div className="text-xs">
            第 <span className="font-mono text-slate-200">{Math.floor(offset / ADMIN_PAGE_SIZE) + 1}</span> 页 · 每页 {ADMIN_PAGE_SIZE} 条 · 本页 {quota.length} 条
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => navigate({ search: { siteId: search.siteId, offset: Math.max(0, offset - ADMIN_PAGE_SIZE) } })}
              className="px-3 py-1 text-xs rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={!!error || quota.length < ADMIN_PAGE_SIZE || offset > Number.MAX_SAFE_INTEGER - 2 * ADMIN_PAGE_SIZE}
              onClick={() => navigate({ search: { siteId: search.siteId, offset: offset + ADMIN_PAGE_SIZE } })}
              className="px-3 py-1 text-xs rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              下一页
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
