---

id: pkg-jobs
type: module-design
title: packages/jobs — 异步生成运行时
status: active
parent: architecture
depends-on: [pkg-core]
---

## 职责

基于 Cloudflare Workflows 的异步AI生成运行时：

- **workflow.ts / runner.ts** — 核心生成 Workflow：借记积分 → 提交上游 → 轮询 → 存R2 → 通知；单向状态机
- **lifecycle.ts** — job状态变更原语：createJob、markSubmitted、markSucceeded、markFailed、cancelQueued；条件UPDATE防止状态回退
- **upstream.ts** — 上游适配器接口：submit/poll/cancel/cost；适配器不接触数据库
- **yir.ts** — Yir.ai SDK 适配器（默认上游）
- **mock.ts** — 本地开发 mock 上游：无需API key，完整测试 upload→charge→poll→deliver→refund 链路
- **models.ts** — definePublicModels / serverModels；浏览器可见字段 vs 服务端字段分离
- **handlers.ts** — 生成请求处理：createJobs（含服务端创建重试 + idempotency）
- **model-overrides.ts** — 后台在线覆盖：白名单字段合并、`model_overrides` 表版本条件写入（清除写 `override_json='null'` 墓碑并递增版本）、任务快照恢复、公开价格查询
- **compose.ts** — ffmpeg Cloudflare Container 交互：视频片段合成、音轨混合
- **repair.ts** — 错位修复：检测人脸未换成功 → 按镜头重渲 → 多轮修复
- **react.ts** — 无头 React hooks（useJob、useJobStatus）

## 边界

- **禁止**：适配器直接操作数据库或积分账本
- **禁止**：站点特定逻辑；通过 site.models.ts + serverModels 注入差异
- 服务端数据（prompts、模型选择、成本上限、参考素材）存入 `*.server.ts`，不经 publicJob 暴露
- 积分在提交上游**之前**扣除（jobId 为幂等键）
- 状态只前进；用户取消仅在 queued 阶段有效；失败/取消从最终状态退款
- 模型覆盖：建任务时读一次生效配置，按生效价格扣费，快照写入 `jobs.override_json` 与任务行、扣费同一 D1 批次；runner 只用快照，不读当前覆盖；幂等重试按落库任务的快照比较请求
- 覆盖值只能改白名单字段，并经过与代码默认值相同的校验；金额按微美元整数精确汇总，最多 6 位小数
- 提示词为 `{{name}}` 字符串模板，变量由站点代码函数计算；默认模板渲染结果须与原函数逐字一致
