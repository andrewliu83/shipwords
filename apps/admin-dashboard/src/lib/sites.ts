export interface ManagedSite {
  id: string;
  name: string;
  binding: string;
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
