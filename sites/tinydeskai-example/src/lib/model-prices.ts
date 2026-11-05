import { createServerFn } from '@tanstack/react-start';

/** Explicit browser allowlist: prompts and upstream configuration never leave the server. */
export const getModelPrices = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ core }, { default: models }, { getModelPrices: prices }] = await Promise.all([
    import('~/core.server'),
    import('~/models.server'),
    import('@shipwords/jobs/model-overrides'),
  ]);
  return prices(core.db, models);
});
