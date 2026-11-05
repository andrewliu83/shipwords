import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { checkAdminAuth, handleAdminGrantCredits } from '../src/admin';
import { getBalance } from '../src/credits/ledger';
import { createDb } from '../src/db/client';
import { user } from '../src/db/schema';

const db = createDb(env.DB);
async function grantInput() {
  const userId = crypto.randomUUID();
  await db.insert(user).values({ id: userId, name: 'Admin test', email: `${userId}@example.com` });
  return { userId, amount: 25, reason: 'support adjustment', idemKey: crypto.randomUUID() };
}

describe('admin security', () => {
  it('fails closed without a configured or matching secret', () => {
    const request = new Request('https://example.com', { headers: { 'x-admin-secret': 'secret' } });
    for (const secret of [undefined, '', '   ', 'wrong']) {
      expect(checkAdminAuth(request, secret)?.status).toBe(403);
    }
    expect(checkAdminAuth(new Request('https://example.com'), 'secret')?.status).toBe(403);
    expect(checkAdminAuth(request, 'secret')).toBeNull();
  });

  it('rejects invalid grant values before writing', async () => {
    const input = await grantInput();
    for (const amount of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(handleAdminGrantCredits(db, { ...input, amount })).rejects.toMatchObject({ status: 400 });
    }
    for (const field of ['userId', 'reason', 'idemKey'] as const) {
      await expect(handleAdminGrantCredits(db, { ...input, [field]: ' ' })).rejects.toMatchObject({ status: 400 });
    }
    await expect(handleAdminGrantCredits(db, { ...input, userId: 'missing' })).rejects.toMatchObject({ status: 404 });
    expect((await getBalance(db, input.userId)).available).toBe(0);
  });

  it('grants once under concurrent retries and returns the original ledger id', async () => {
    const input = await grantInput();
    const results = await Promise.all(Array.from({ length: 4 }, () => handleAdminGrantCredits(db, input)));
    expect(results.filter((result) => result.applied)).toHaveLength(1);
    expect(new Set(results.map((result) => result.ledgerId)).size).toBe(1);
    expect((await getBalance(db, input.userId)).available).toBe(25);
  });

  it('rejects key reuse with changed user, amount or reason', async () => {
    const input = await grantInput();
    await handleAdminGrantCredits(db, input);
    const other = await grantInput();
    for (const change of [{ amount: 26 }, { reason: 'different' }, { userId: other.userId }]) {
      await expect(handleAdminGrantCredits(db, { ...input, ...change })).rejects.toMatchObject({ status: 409 });
    }
    expect((await getBalance(db, input.userId)).available).toBe(25);
    expect((await getBalance(db, other.userId)).available).toBe(0);
  });

  it('allows only one of concurrent conflicting grants', async () => {
    const input = await grantInput();
    const results = await Promise.allSettled([
      handleAdminGrantCredits(db, input),
      handleAdminGrantCredits(db, { ...input, amount: 30 }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason.status).toBe(409);
    expect([25, 30]).toContain((await getBalance(db, input.userId)).available);
  });
});
