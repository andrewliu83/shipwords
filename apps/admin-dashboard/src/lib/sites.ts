export interface ManagedSite {
  id: string;
  name: string;
  binding: string;
}

export function resolveSiteId(value: unknown): string | undefined {
  if (value === undefined) return MANAGED_SITES[0]?.id;
  if (typeof value !== 'string' || !MANAGED_SITES.some((site) => site.id === value)) {
    throw new Error('未知的受管站点');
  }
  return value;
}

/**
 * 所有受管站点列表
 * 当增加新站点时，在此处追加配置，并在 wrangler.jsonc 中添加相应的 service binding
 */
export const MANAGED_SITES: ManagedSite[] = [
  {
    id: 'tinydeskai-example',
    name: 'TinyDesk AI (Example)',
    binding: 'TINYDESKAI',
  },
];
