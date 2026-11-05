import {
  AdminRequestError,
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

        const body = (await request.json().catch(() => null)) as {
          action: string;
          params?: Record<string, unknown>;
        } | null;

        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.action !== 'string' ||
          (body.params !== undefined && (!body.params || typeof body.params !== 'object' || Array.isArray(body.params)))) {
          return errorResponse(400, 'invalid request');
        }

        const { action, params = {} } = body;
        const limit = typeof params.limit === 'number' ? params.limit : 50;
        const offset = typeof params.offset === 'number' ? params.offset : 0;
        if ((params.limit !== undefined && typeof params.limit !== 'number') ||
          (params.offset !== undefined && typeof params.offset !== 'number') ||
          !Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
          !Number.isSafeInteger(offset) || offset < 0) {
          return errorResponse(400, 'invalid pagination');
        }

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
              const { userId, amount, reason, idemKey } = params as {
                userId?: string;
                amount?: number;
                reason?: string;
                idemKey?: string;
              };
              if (typeof userId !== 'string' || typeof amount !== 'number' || typeof reason !== 'string' || typeof idemKey !== 'string') {
                return errorResponse(400, 'userId, amount, reason and idemKey required');
              }
              const result = await handleAdminGrantCredits(core.db, {
                userId,
                amount,
                reason,
                idemKey,
              });
              return json({ success: true, result });
            }

            default:
              return errorResponse(400, `unknown action: ${action}`);
          }
        } catch (err: unknown) {
          if (err instanceof AdminRequestError) return errorResponse(err.status, err.message);
          return errorResponse(500, 'internal error');
        }
      },
    },
  },
});
