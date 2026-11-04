---
id: tools
type: module-design
title: tools/ — 仓库脚本
status: active
parent: architecture
---

## 职责

`tools/` 下的仓库级 Node.js 脚本（仅使用 Node 内置模块，每个脚本有测试）：

- **new-site.mjs** — 从 `templates/ai-site` 复制并重命名，创建新站点骨架
- **check-site.mjs** — 站点上线前检查：必须路由、policy页面、无跨站导入、browser bundle 无泄漏
- **list-sites.mjs** — 从各站点代码和 README 生成站点列表
- **setup-worktree.mjs** — 新 worktree 初始化：复制 secrets、修复 dev 端口
- **dev-port.mjs** — 从站点名派生本地开发端口
- **stripe-listen.mjs** — 包装 stripe listen，转发 test webhook 并自动更新签名密钥

## 边界

- **仅 Node 内置模块**：不依赖任何 npm 包
- 每个脚本必须有对应测试（`pnpm test:tools`）
