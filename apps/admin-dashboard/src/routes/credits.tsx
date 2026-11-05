import type { AdminLedgerItem } from '@shipwords/core/admin';
import { createFileRoute } from '@tanstack/react-router';
import { ADMIN_PAGE_SIZE, getAdminLedger } from '~/lib/site-rpc';
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

export const Route = createFileRoute('/credits')({
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
    if (!activeSite) return { ledger: [], activeSite: null, error: '未找到配置的站点', offset: deps.offset };

    try {
      const ledger = await getAdminLedger({
        data: { siteId: activeSite.id, limit: ADMIN_PAGE_SIZE, offset: deps.offset },
      });
      return { ledger, activeSite, error: null, offset: deps.offset };
    } catch (err: unknown) {
      return {
        ledger: [],
        activeSite,
        error: err instanceof Error ? err.message : '获取流水失败',
        offset: deps.offset,
      };
    }
  },
  component: CreditsPage,
});

function CreditsPage() {
  const { ledger, error, offset } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const getKindBadge = (kind: string) => {
    switch (kind) {
      case 'grant':
        return <span className="px-2 py-0.5 rounded text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">+ 发放</span>;
      case 'spend':
        return <span className="px-2 py-0.5 rounded text-xs font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">- 消费</span>;
      case 'refund':
        return <span className="px-2 py-0.5 rounded text-xs font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">↩ 退款</span>;
      case 'revoke':
        return <span className="px-2 py-0.5 rounded text-xs font-mono bg-rose-500/10 text-rose-400 border border-rose-500/20">✕ 撤销</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-xs font-mono bg-slate-800 text-slate-400">{kind}</span>;
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">积分账本</h1>
          <p className="text-sm text-slate-400 mt-1">全局积分流水账本，严格单 D1 批次写入审计</p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="credits-site-select" className="text-xs text-slate-400">选择站点:</label>
          <select
            id="credits-site-select"
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
                <th className="py-3 px-4">用户</th>
                <th className="py-3 px-4">动作类型</th>
                <th className="py-3 px-4">变动分值</th>
                <th className="py-3 px-4">关联引用 / 备注</th>
                <th className="py-3 px-4">幂等键</th>
                <th className="py-3 px-4 text-right">记录时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {ledger.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    暂无流水明细
                  </td>
                </tr>
              ) : (
                ledger.map((item: AdminLedgerItem) => (
                  <tr key={item.id} className="hover:bg-slate-850/30 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-medium text-white">{item.userEmail || item.userId}</div>
                    </td>
                    <td className="py-3 px-4">{getKindBadge(item.kind)}</td>
                    <td className="py-3 px-4 font-mono font-medium">
                      <span className={item.delta > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {item.delta > 0 ? `+${item.delta}` : item.delta}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-400">
                      {item.ref || '-'}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-slate-500 max-w-[150px] truncate" title={item.idemKey}>
                      {item.idemKey}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-400 font-mono text-right whitespace-nowrap">
                      {new Date(item.createdAt).toLocaleString('zh-CN')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 bg-slate-900/60 text-sm text-slate-400">
          <div className="text-xs">
            第 <span className="font-mono text-slate-200">{Math.floor(offset / ADMIN_PAGE_SIZE) + 1}</span> 页 · 每页 {ADMIN_PAGE_SIZE} 条 · 本页 {ledger.length} 条
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
              disabled={!!error || ledger.length < ADMIN_PAGE_SIZE || offset > Number.MAX_SAFE_INTEGER - 2 * ADMIN_PAGE_SIZE}
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
