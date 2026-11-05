---

id: task-admin-dashboard
type: task-spec
title: 统一管理界面（Admin Dashboard）
status: draft
parent: sites
---

## 请求

用户希望在当前 shipwords 项目中新增一个"统一管理界面"，用于跨站点或单站点的运营管理。

## 现状分析

- **无任何 admin 页面**：全项目没有 admin/dashboard/management 路由
- **无 RBAC 权限系统**：user 表无 role 字段，仅区分访客 vs 已登录用户
- **数据分散**：每个站点独立 D1，彼此物理隔离；没有跨站点聚合视图
- **goal 中明确标注**："Admin后台（所有状态在D1）" 属于"开放方向（未建，不阻止后续添加）"

## 核心设计决策（待用户确认）

### 决策 A：管理界面的部署位置

| 方案                    | 说明                                  | 优                               | 劣                                          |
| ----------------------- | ------------------------------------- | -------------------------------- | ------------------------------------------- |
| **A1 嵌入每个站点**     | 在每个 site 内加 `/admin/*` 路由      | 直接访问本站 D1，无需额外 Worker | 无跨站视图；每新建一个站点都要重复          |
| **A2 独立 sidecar app** | 新建 `apps/admin/`，部署为独立 Worker | 可聚合多站点数据；单点维护       | 跨 D1 访问需通过 Service Bindings；比较复杂 |
| **A3 本地/开发者工具**  | CLI/脚本 + 本地 wrangler dev 查看     | 零生产风险；已有 D1 数据直接查   | 非实时、非 Web UI                           |

### 决策 B：认证方式

| 方案                                       | 说明                                                |
| ------------------------------------------ | --------------------------------------------------- |
| **B1 复用 Better Auth + 管理员邮箱白名单** | 在 site.config.ts 中配置 adminEmails，server 端检查 |
| **B2 Cloudflare Access**                   | 在 Worker 前加 CF Zero Trust，无需代码内鉴权        |
| **B3 独立密码/token**                      | env secret 中配置 ADMIN_TOKEN，HTTP Basic Auth      |

### 决策 C：功能范围（MVP）

候选功能：
- 用户列表（邮箱、注册时间、积分余额）
- 积分账本查看（grant/spend/refund 历史）
- 任务/Job 列表（状态、模型、时间）
- 支付记录（Stripe/PayPal 订单）
- 访客配额监控
- 跨站点聚合报表

## 待用户回答

1. 管理界面面向谁？（个人开发者自用 vs 给团队成员）
2. 是否需要跨站点视图？（单站点够用 vs 要在一处看所有站点）
3. 对认证方式的偏好？
4. MVP 功能范围？

## 用户确认

- **使用对象**：个人开发者自用
- **视图范围**：需要跨站点视图
- **MVP 功能**：用户列表、积分账本、任务/Job 列表、支付记录、访客配额监控、手动操作（补发积分等）

## 推荐方案

### 部署架构：独立 sidecar app (`apps/admin-dashboard/`)

**理由**：
- 用户明确需要跨站点视图 → 单站点内嵌方案无法满足
- 个人开发者自用 → 安全模型可相对简化，无需复杂 RBAC
- 跨 D1 访问通过 **Service Bindings** 实现，让 admin Worker 绑定各站点 Worker，通过 RPC 获取数据

**技术栈**：
- TanStack Start + React 19（与站点一致）
- 独立 Worker，不共享 D1（admin 无状态，数据全来自各站点）
- Tailwind v4（样式独立）

### 认证方案：HTTP Basic Auth + ENV 密码

**理由**：
- 个人开发者自用，复用 Better Auth 过重
- 在 `wrangler.toml` 中配置 `ADMIN_PASSWORD`（secret），middleware 校验
- Cloudflare Access 更好，但需用户自行在 CF Dashboard 配置

### Service Bindings 架构

```
apps/admin-dashboard/
  wrangler.toml:
    [[services]]
    binding = "TINYDESKAI"
    service = "tinydeskai-example"
    environment = "production"

sites/tinydeskai-example/
  添加 RPC 端点：src/routes/api/admin-rpc/index.ts
    - getUsers()
    - getCreditLedger()
    - getJobs()
    - getBillingRecords()
    - getGuestQuota()
    - manualGrantCredits(userId, amount, reason)
```

admin Worker 通过 `env.TINYDESKAI.fetch(new Request('/api/admin-rpc/...'))` 获取数据。

### 路由设计

```
apps/admin-dashboard/src/routes/
  index.tsx         — Dashboard 首页，跨站点概览
  users.tsx         — 用户列表（所有站点）
  credits.tsx       — 积分账本
  jobs.tsx          — 任务列表
  billing.tsx       — 支付记录
  quota.tsx         — 访客配额监控
  operations.tsx    — 手动操作（补积分、调账）
```

### 分阶段实现

**Phase 1 (MVP)**：
1. 搭建 admin Worker 骨架 + 认证中间件
2. tinydeskai-example 添加 admin-rpc 端点（read-only）
3. admin UI 实现用户列表 + 积分账本（只读）

**Phase 2**：
4. 添加任务列表、支付记录、配额监控页面
5. 实现手动操作端点（幂等键 + 审计日志）

**Phase 3**（未来）：
6. 当有第二个站点时，自动聚合多站点数据
7. 添加图表、导出功能

## 待实现细节

- [ ] Service Bindings 如何传递调用者身份（admin 本身的认证 vs RPC 端点的二次校验）
- [ ] 手动操作的审计日志存哪儿（各站点 D1 新表 vs admin 自己的 KV）
- [ ] 跨站点查询性能（串行 fetch vs 并发）

## 风险与约束

- **安全**：admin-rpc 端点暴露敏感数据，必须有独立校验（env secret 校验 admin 调用）
- **部署**：admin Worker 与站点 Worker 的部署顺序（Service Bindings 生效需两端都上线）
- **测试**：admin-rpc 需要单元测试（带 mock Service Bindings）

## 状态

✅ 用户已批准，开始实现 Phase 1。
