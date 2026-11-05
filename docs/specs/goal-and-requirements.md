---

id: goal
type: goal-and-requirements
title: "shipwords: 关键词AI站点fleet框架"
status: draft
---

## 目标

shipwords 是一个开源框架（MIT），用于在 Cloudflare 上运行一组关键词 AI 图像/视频站点，每个关键词一个独立站点。

1. **为每个新关键词快速上线一个独立站点** — 新站点在一个下午内完成，发布当天即可接受支付；共享代码（账号、支付、积分、生成引擎）一次编写；站点差异（页面、外观、域名）各自拥有。
2. **隔离的支付和部署** — 每个站点独立 Worker、D1、R2、secrets 和支付账户；上线或关停一个站点不影响其他站点。
3. **首日即可支付** — Google/邮箱登录、积分包/订阅、退款、争议处理；访客免费试用（reCAPTCHA防滥用）；SEO、sitemap、隐私条款、DMCA页面。
4. **AI友好** — 配置即代码，金钱路径有测试，检查快速，AGENTS.md 指导AI编码。

## 范围

**包含：**
- 共享包：core（数据库、认证、支付、积分、配额）、jobs（异步生成运行时）
- 站点模板（templates/ai-site）：完整可工作的AI图像站点
- 示例站点（sites/tinydeskai-example）：tinydeskai.io 完整源码
- 工具（tools/）：站点脚手架、上线检查、本地开发辅助

**开放方向（未建，不阻止后续添加）：**
- Admin后台（所有状态在D1）
- Agent API
- 跨站点统计

## 主要用户

想快速上线AI关键词站点的开发者和小团队，需要有 Node.js、TypeScript、React、Cloudflare Workers 基础。

## 约束

1. **Cloudflare Only**：Workers、D1、R2、Workflows（可选 Containers）
2. **技术栈**：TanStack Start + React 19、D1 + Drizzle、Better Auth、Tailwind v4
3. **站点隔离**：站点间禁止互相导入（Biome + check-site 强制执行）
4. **金钱写入严格**：幂等键 + 单个 D1 批次 + 条件 UPDATE，不来自 webhook 内容
5. **浏览器边界**：`*.server.ts` 不打包到客户端，secrets 仅从 Worker env 读取

## 成功指标

- 新站点从模板到本地运行 < 10 分钟
- 从本地到上线（含支付配置）< 1 天
- 核心包测试覆盖金钱路径（debits、webhooks、refunds）
- `pnpm --filter "./sites/<site>" check` 通过 = 可上线
