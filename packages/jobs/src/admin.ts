import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '@shipwords/core/db/client';
import { user } from '@shipwords/core/db/schema';
import { jobs } from './schema';

export interface AdminJobItem {
  id: string;
  userId: string | null;
  userEmail?: string | null;
  guestId: string | null;
  modelId: string;
  kind: 'image' | 'video' | 'music';
  prompt: string;
  costCredits: number;
  status: 'queued' | 'submitted' | 'succeeded' | 'failed' | 'canceled';
  upstream: string;
  upstreamJobId: string | null;
  upstreamCostUsd: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  submittedAt: number | null;
  finishedAt: number | null;
}

/**
 * 获取任务列表
 */
export async function getAdminJobs(db: Db, limit = 50, offset = 0): Promise<AdminJobItem[]> {
  const records = await db
    .select({
      id: jobs.id,
      userId: jobs.userId,
      userEmail: user.email,
      guestId: jobs.guestId,
      modelId: jobs.modelId,
      kind: jobs.kind,
      prompt: jobs.prompt,
      costCredits: jobs.costCredits,
      status: jobs.status,
      upstream: jobs.upstream,
      upstreamJobId: jobs.upstreamJobId,
      upstreamCostUsd: jobs.upstreamCostUsd,
      errorCode: jobs.errorCode,
      errorMessage: jobs.errorMessage,
      createdAt: jobs.createdAt,
      submittedAt: jobs.submittedAt,
      finishedAt: jobs.finishedAt,
    })
    .from(jobs)
    .leftJoin(user, eq(jobs.userId, user.id))
    .orderBy(desc(jobs.createdAt))
    .limit(limit)
    .offset(offset);

  return records;
}
