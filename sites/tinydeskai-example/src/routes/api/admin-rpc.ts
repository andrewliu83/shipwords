import {
  checkAdminAuth,
  getAdminLedger,
  getAdminPayments,
  getAdminQuota,
  getAdminUsers,
  handleAdminGrantCredits,
} from '@shipwords/core/admin';
import { errorResponse, json } from '@shipwords/core/http';
import { getAdminJobs } from '@shipwords/jobs/admin';
import { createFileRoute } from '@tanstack/react-router';
import { core } from '~/core.server';

export const Route = createFileRoute('/api/admin-rpc')({
  server: {
    handlers: {
      async POST({ request }) {
        // 鉴权
        const authError = checkAdminAuth(request, core.env.ADMIN_SECRET);
        if (authError) return authError;

        const body = (await request.json().catch(() => ({}))) as {
          action: string;
          params?: Record<string, unknown>;
        };

        const { action, params = {} } = body;
        const limit = typeof params.limit === 'number' ? params.limit : 50;
        const offset = typeof params.offset === 'number' ? params.offset : 0;

        try {
          switch (action) {
            case 'getUsers': {
              const users = await getAdminUsers(core.db, limit, offset);
              return json({ users });
            }

            case 'getLedger': {
              const ledger = await getAdminLedger(core.db, limit, offset);
              return json({ ledger });
            }

            case 'getJobs': {
              const jobs = await getAdminJobs(core.db, limit, offset);
              return json({ jobs });
            }

            case 'getPayments': {
              const payments = await getAdminPayments(core.db, limit, offset);
              return json({ payments });
            }

            case 'getQuota': {
              const quota = await getAdminQuota(core.db, limit, offset);
              return json({ quota });
            }

            case 'grantCredits': {
              const { userId, amount, reason } = params as {
                userId?: string;
                amount?: number;
                reason?: string;
              };
              if (!userId || !amount) {
                return errorResponse(400, 'userId and amount required');
              }
              const result = await handleAdminGrantCredits(core.db, {
                userId,
                amount,
                reason: reason || 'admin-manual-grant',
              });
              return json({ success: true, result });
            }

            default:
              return errorResponse(400, `unknown action: ${action}`);
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'internal error';
          return errorResponse(500, message);
        }
      },
    },
  },
});
