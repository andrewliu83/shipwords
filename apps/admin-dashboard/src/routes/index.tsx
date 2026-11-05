import { createFileRoute, Link } from '@tanstack/react-router';
import { getSiteStatus } from '~/lib/site-rpc';
import { MANAGED_SITES } from '~/lib/sites';

interface SiteStats {
  siteId: string;
  siteName: string;
  status: 'online' | 'offline';
  error?: string;
}

export const Route = createFileRoute('/')({
  loader: async () => {
    const stats: SiteStats[] = await Promise.all(
      MANAGED_SITES.map(async (site) => ({
        siteId: site.id,
        siteName: site.name,
        ...(await getSiteStatus({ data: { siteId: site.id } })),
      })),
    );
    return { stats };
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { stats } = Route.useLoaderData();

  return (
    <div className="space-y-8">
      {/* 页头 */}
      <div>
        <h1 className="text-3xl font-bold text-white">管理控制台</h1>
        <p className="text-slate-400 mt-2">跨站点聚合管理 · Service Bindings 直连</p>
      </div>

      {/* 指标卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="text-sm font-medium text-slate-400">受管站点</div>
          <div className="text-3xl font-bold text-white mt-2 font-mono">{stats.length}</div>
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
          <div className="text-xl font-bold text-indigo-400 mt-2">单点控制台</div>
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
          {stats.map(
            (site: { siteId: string; siteName: string; status: 'online' | 'offline'; error?: string }) => (
              <div
                key={site.siteId}
                className="p-6 flex items-center justify-between hover:bg-slate-850/30 transition-colors"
              >
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
                      {site.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 font-mono">{site.siteId}</div>
                  {site.error && <div className="text-xs text-rose-400">{site.error}</div>}
                </div>
                <div className="flex gap-2">
                  <Link
                    to="/users"
                    search={{ siteId: site.siteId }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 transition-colors"
                  >
                    用户
                  </Link>
                  <Link
                    to="/jobs"
                    search={{ siteId: site.siteId }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 transition-colors"
                  >
                    任务
                  </Link>
                  <Link
                    to="/billing"
                    search={{ siteId: site.siteId }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 transition-colors"
                  >
                    支付
                  </Link>
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      {/* 快速访问 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link
          to="/users"
          className="p-6 rounded-xl border border-slate-800 bg-slate-900/40 hover:bg-slate-850/50 hover:border-indigo-500/30 transition-all group"
        >
          <div className="text-lg font-semibold text-white group-hover:text-indigo-400 transition-colors">
            用户管理
          </div>
          <div className="text-sm text-slate-400 mt-1">查看用户列表、余额与充值记录</div>
        </Link>
        <Link
          to="/credits"
          className="p-6 rounded-xl border border-slate-800 bg-slate-900/40 hover:bg-slate-850/50 hover:border-indigo-500/30 transition-all group"
        >
          <div className="text-lg font-semibold text-white group-hover:text-indigo-400 transition-colors">
            积分流水
          </div>
          <div className="text-sm text-slate-400 mt-1">查看积分账本明细与操作历史</div>
        </Link>
        <Link
          to="/jobs"
          className="p-6 rounded-xl border border-slate-800 bg-slate-900/40 hover:bg-slate-850/50 hover:border-indigo-500/30 transition-all group"
        >
          <div className="text-lg font-semibold text-white group-hover:text-indigo-400 transition-colors">
            任务监控
          </div>
          <div className="text-sm text-slate-400 mt-1">查看生成任务状态与错误日志</div>
        </Link>
        <Link
          to="/billing"
          className="p-6 rounded-xl border border-slate-800 bg-slate-900/40 hover:bg-slate-850/50 hover:border-indigo-500/30 transition-all group"
        >
          <div className="text-lg font-semibold text-white group-hover:text-indigo-400 transition-colors">
            支付追踪
          </div>
          <div className="text-sm text-slate-400 mt-1">查看支付记录与退款状态</div>
        </Link>
      </div>
    </div>
  );
}
