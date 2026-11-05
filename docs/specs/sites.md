---

id: sites
type: module-design
title: sites/<site> — 关键词站点
status: active
parent: architecture
depends-on: [pkg-core, pkg-jobs]
---

## 职责

每个 `sites/<site>/` 是一个完整的、独立部署的 TanStack Start 应用：

- **site.config.ts** — 品牌、locale、产品目录、配额、支付提供商、分析ID；是注入包差异的入口
- **site.models.ts** — `definePublicModels`：页面可见的模型信息（名称、积分成本、访客资格）；打包到浏览器
- **src/models.server.ts** — `serverModels`：每个模型的服务端信息（上游模型、maxCost、效果预设）；绝不打包到浏览器
- **src/routes/** — 页面和API路由（TanStack Start）；必须包含：首页、定价、账户、登录、隐私、条款、退款、DMCA
- **src/site/** — 站点独有组件、样式（Tailwind v4）；每个站点外观必须独特
- **migrations/** — 由 `pnpm db:generate` 生成（timestamp前缀）；包含 core + jobs + 站点自有表
- **wrangler.jsonc** — Worker配置：D1、R2、Workflows bindings、secrets声明
- **DESIGN.md** — 站点视觉方向（修改样式前必须先写此文件）
- **README.md** — 站点档案：关键词、竞品、上线日期、支付账户、状态

## 边界

- **禁止**：导入其他站点（Biome + check-site 强制检查）
- **禁止**：将 prompts、参考素材、模型选择放到 site.models.ts
- **禁止**：从 `env` 直接转发到客户端（需通过 allowlist server function）
- 生成文件（routeTree.gen.ts、paraglide输出）不提交
- 预览：`pnpm deploy:preview`；生产：只从 main 分支部署，一次一个站点，需用户明确确认
