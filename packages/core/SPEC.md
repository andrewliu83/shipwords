---

id: pkg-core
type: module-design
title: packages/core — 共享核心包
status: active
parent: architecture
---

## 职责

所有站点共享的基础设施，每个功能只实现一次：

- **db/** — D1 + Drizzle ORM；定义用户、订单、支付、订阅、积分账本、webhook事件、访客配额等核心表；生成 timestamp 前缀的迁移文件到各站点
- **auth/** — Better Auth：Google OAuth、One Tap、邮箱一次性密码（无密码）；与核心DB绑定
- **billing/** — Stripe 和 PayPal 支付适配器（provider interface）；订单→支付→积分授予的状态机；webhook去重、fetchState从API读取状态（不信任event内容）
- **credits/** — 积分账本：借记（带幂等键）、余额查询、退款；负余额阻止新消费
- **quota/** — 访客每日配额（IP + device cookie）；reCAPTCHA v3评分；注册奖励（防农场）
- **email/** — Cloudflare Email Service binding；模板（en/ja/ko内置）
- **seo.ts** — sitemap、robots.txt、GEO helpers
- **analytics.ts** — GA4/Rybbit 代理（通过站点的 `/stats/`）
- **react/** — 无头 React hooks（usePricing、useCheckout 等）；无页面无样式
- **site.ts** — 站点配置类型（SiteConfig、product catalog schema）；供站点通过 `site.config.ts` 注入差异

## 边界

- **禁止**：页面、组件、样式、站点特定逻辑
- **禁止**：站点名称硬编码进包代码
- 站点差异通过 `site.config.ts`、`site.models.ts` 和注册函数传入
- 每次金钱写入必须携带幂等键；多行写入放入单一 D1 批次 + 条件 UPDATE
- Webhook 只是触发信号；状态从 provider API 读取
