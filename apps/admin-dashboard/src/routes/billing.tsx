import type { AdminPaymentItem } from '@shipwords/core/admin';
import { createFileRoute } from '@tanstack/react-router';
import { callSiteRpc } from '~/lib/site-rpc.server';
import { MANAGED_SITES } from '~/lib/sites';

interface SearchParams {
  siteId?: string;
}

export const Route = createFileRoute('/billing')({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    siteId: (search.siteId as string) || MANAGED_SITES[0]?.id,
  }),
  loaderDeps: ({ search }) => ({ siteId: search.siteId }),
  loader: async ({ deps }) => {
    const activeSite = MANAGED_SITES.find((s) => s.id === deps.siteId) || MANAGED_SITES[0];
    if (!activeSite) return { payments: [], activeSite: null, error: '未找到配置的站点' };

    try {
      const res = await callSiteRpc<{ payments: AdminPaymentItem[] }>(
        activeSite.binding,
        'getPayments',
        { limit: 50 },
      );
      return { payments: res.payments, activeSite, error: null };
    } catch (err: unknown) {
      return {
        payments: [],
        activeSite,
        error: err instanceof Error ? err.message : '获取支付记录失败',
      };
    }
  },
  component: BillingPage,
});

function BillingPage() {
  const { payments, error } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">支付记录</h1>
          <p className="text-sm text-slate-400 mt-1">Stripe / PayPal 订单状态及退款追踪</p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="billing-site-select" className="text-xs text-slate-400">选择站点:</label>
          <select
            id="billing-site-select"
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

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">用户</th>
                <th className="py-3 px-4">渠道</th>
                <th className="py-3 px-4">交易单号</th>
                <th className="py-3 px-4">金额</th>
                <th className="py-3 px-4">到账积分</th>
                <th className="py-3 px-4 text-right">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    暂无支付记录
                  </td>
                </tr>
              ) : (
                payments.map((p: AdminPaymentItem) => (
                  <tr key={p.id} className="hover:bg-slate-850/30 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-medium text-white">{p.userEmail || p.userId}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-xs font-mono uppercase bg-slate-800 text-slate-300 border border-slate-700">
                        {p.provider}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-slate-400 max-w-[150px] truncate" title={p.paymentRef}>
                      {p.paymentRef}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium text-white">
                      {(p.amount / 100).toFixed(2)} {p.currency.toUpperCase()}
                      {p.amountRefunded > 0 && (
                        <div className="text-xs text-rose-400 mt-0.5">
                          已退: {(p.amountRefunded / 100).toFixed(2)}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-indigo-400">
                      +{p.creditsGranted}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-400 font-mono text-right whitespace-nowrap">
                      {new Date(p.createdAt).toLocaleString('zh-CN')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
