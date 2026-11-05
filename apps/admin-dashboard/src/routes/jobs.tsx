import type { AdminJobItem } from '@shipwords/jobs/admin';
import { createFileRoute } from '@tanstack/react-router';
import { ADMIN_PAGE_SIZE, getAdminJobs } from '~/lib/site-rpc';
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

export const Route = createFileRoute('/jobs')({
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
    if (!activeSite) return { jobs: [], activeSite: null, error: '未找到配置的站点', offset: deps.offset };

    try {
      const jobs = await getAdminJobs({
        data: { siteId: activeSite.id, limit: ADMIN_PAGE_SIZE, offset: deps.offset },
      });
      return { jobs, activeSite, error: null, offset: deps.offset };
    } catch (err: unknown) {
      return {
        jobs: [],
        activeSite,
        error: err instanceof Error ? err.message : '获取任务列表失败',
        offset: deps.offset,
      };
    }
  },
  component: JobsPage,
});

function JobsPage() {
  const { jobs, error, offset } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'succeeded':
        return <span className="px-2 py-0.5 rounded text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">● 成功</span>;
      case 'submitted':
        return <span className="px-2 py-0.5 rounded text-xs font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">◌ 执行中</span>;
      case 'queued':
        return <span className="px-2 py-0.5 rounded text-xs font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">⋯ 排队中</span>;
      case 'failed':
        return <span className="px-2 py-0.5 rounded text-xs font-mono bg-rose-500/10 text-rose-400 border border-rose-500/20">✕ 失败</span>;
      case 'canceled':
        return <span className="px-2 py-0.5 rounded text-xs font-mono bg-slate-800 text-slate-400 border border-slate-700">⊘ 取消</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-xs font-mono bg-slate-800 text-slate-400">{status}</span>;
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">生成任务 (Jobs)</h1>
          <p className="text-sm text-slate-400 mt-1">异步生成任务队列与上游模型消耗监控</p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="jobs-site-select" className="text-xs text-slate-400">选择站点:</label>
          <select
            id="jobs-site-select"
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
                <th className="py-3 px-4">任务 ID / 提示词</th>
                <th className="py-3 px-4">用户</th>
                <th className="py-3 px-4">模型 / 供应商</th>
                <th className="py-3 px-4">状态</th>
                <th className="py-3 px-4">成本 (积分 / 上游)</th>
                <th className="py-3 px-4 text-right">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    暂无任务记录
                  </td>
                </tr>
              ) : (
                jobs.map((job: AdminJobItem) => (
                  <tr key={job.id} className="hover:bg-slate-850/30 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-mono text-xs text-slate-400">{job.id}</div>
                      <div className="text-xs text-slate-300 truncate max-w-[200px] mt-0.5" title={job.prompt}>
                        {job.prompt}
                      </div>
                      {job.errorMessage && (
                        <div className="text-xs text-rose-400 truncate max-w-[200px] mt-0.5">
                          {job.errorMessage}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {job.userEmail ? (
                        <span className="text-white">{job.userEmail}</span>
                      ) : (
                        <span className="text-slate-500 font-mono">访客 ({job.guestId?.slice(0, 8)})</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <div className="text-white">{job.modelId}</div>
                      <div className="text-slate-500 font-mono mt-0.5">{job.upstream}</div>
                    </td>
                    <td className="py-3 px-4">{getStatusBadge(job.status)}</td>
                    <td className="py-3 px-4 font-mono text-xs">
                      <div>{job.costCredits} 积分</div>
                      <div className="text-slate-500 mt-0.5">
                        {job.upstreamCostUsd ? `$${job.upstreamCostUsd}` : '-'}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-400 font-mono text-right whitespace-nowrap">
                      {new Date(job.createdAt).toLocaleString('zh-CN')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 bg-slate-900/60 text-sm text-slate-400">
          <div className="text-xs">
            第 <span className="font-mono text-slate-200">{Math.floor(offset / ADMIN_PAGE_SIZE) + 1}</span> 页 · 每页 {ADMIN_PAGE_SIZE} 条 · 本页 {jobs.length} 条
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
              disabled={!!error || jobs.length < ADMIN_PAGE_SIZE || offset > Number.MAX_SAFE_INTEGER - 2 * ADMIN_PAGE_SIZE}
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
