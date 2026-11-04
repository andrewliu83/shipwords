import { createFileRoute, Link } from '@tanstack/react-router';
import { callSiteRpc } from '~/lib/site-rpc.server';
import { MANAGED_SITES } from '~/lib/sites';

interface SiteStats {
  siteId: string;
  siteName: string;
  userCount: number;
  jobCount: number;
  paymentCount: number;
  status: 'online' | 'offline';
  error?: string;
}

export const Route = createFileRoute('/')({
  loader: async () => {
    const stats: SiteStats[] = await Promise.all(
      MANAGED_SITES.map(async (site) => {
        try {
          const [usersRes, jobsRes, paymentsRes] = await Promise.all([
            callSiteRpc<{ users: unknown[] }>(site.binding, 'getUsers', { limit: 1 }),
            callSiteRpc<{ jobs: unknown[] }>(site.binding, 'getJobs', { limit: 1 }),
            callSiteRpc<{ payments: unknown[] }>(site.binding, 'getPayments', { limit: 1 }),
          ]);
          return {
            siteId: site.id,
            siteName: site.name,
            userCount: usersRes.users?.length ?? 0,
            jobCount: jobsRes.jobs?.length ?? 0,
            paymentCount: paymentsRes.payments?.length ?? 0,
            status: 'online',
          };
        } catch (err: unknown) {
          return {
            siteId: site.id,
            siteName: site.name,
            userCount: 0,
            jobCount: 0,
            paymentCount: 0,
            status: 'offline',
            error: err instanceof Error ? err.message : '连接失败',
          };
        }
      }),
    );
    return { stats };
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { stats } = Route.useLoaderData();

  return (
    <div className="space-y-8 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">仪表盘</h1>
        <p className="text-sm text-slate-400 mt-1">
          管理所有连接的关键词独立站点，监控流量、任务与营收。
        </p>
      </div>

      {/* 快捷指标 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="text-sm font-medium text-slate-400">接入站点数</div>
          <div className="text-3xl font-bold text-white mt-2 font-mono">
            {MANAGED_SITES.length}
          </div>
          <div className="text-xs text-slate-500 mt-1">通过 Service Bindings 直连</div>
        </div>
        <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="text-sm font-medium text-slate-400">运行状态</div>
          <div className="text-3xl font-bold text-emerald-400 mt-2 font-mono">
            {stats.filter((s: { status: string }) => s.status === 'online').length} / {stats.length}
          </div>
          <div className="text-xs text-slate-500 mt-1">站点正常响应</div>
        </div>
        <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="text-sm font-medium text-slate-400">管理模式</div>
          <div className="text-xl font-bold text-indigo-400 mt-2">
            单点控制台
          </div>
          <div className="text-xs text-slate-500 mt-1">零跨库外键，纯 RPC 调度</div>
        </div>
      </div>

      {/* 站点列表 */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <div className="p-6 border-b border-slate-800 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-white">受管站点列表</h2>
          <span className="text-xs text-slate-400 font-mono">共 {stats.length} 个站点</span>
        </div>
        <div className="divide-y divide-slate-800">
          {stats.map((site: { siteId: string; siteName: string; status: 'online' | 'offline'; error?: string }) => (
            <div key={site.siteId} className="p-6 flex items-center justify-between hover:bg-slate-850/30 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-white">{site.siteName}</span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium font-mono ${
                      site.status === 'online'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}
                  >
                    {site.status === 'online' ? '● 正常' : '○ 离线'}
                  </span>
                </div>
                <div className="text-xs text-slate-500 font-mono">ID: {site.siteId}</div>
                {site.error && (
                  <div className="text-xs text-rose-400 mt-1">{site.error}</div>
                )}
              </div>

              <div className="flex gap-3">
                <Link
                  to="/users"
                  search={{ siteId: site.siteId }}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors"
                >
                  查看用户
                </Link>
                <Link
                  to="/jobs"
                  search={{ siteId: site.siteId }}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors"
                >
                  查看任务
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
