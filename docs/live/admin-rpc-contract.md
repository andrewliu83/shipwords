# 管理后台 RPC 接口变更

管理后台通过站点的 Service Binding 调用 `POST /api/admin-rpc`，并在 `x-admin-secret` 中提供站点配置的 `ADMIN_SECRET`。未配置或密钥不匹配时拒绝请求；Service Binding 本身不使 HTTP 路由私有。

查询请求使用 `{ action, params }`，可选分页参数 `limit` 为 1–200 的整数，`offset` 为非负安全整数。返回对象分别包含 `users`、`ledger`、`jobs`、`payments` 或 `quota` 数组。

`grantCredits` 的 `params` 必须包含 `userId`、`amount`、`reason` 和 `idemKey`。金额必须为正安全整数；字符串不能为空或带首尾空格，长度分别不超过 256、1000 和 128 字符。对同一操作的重试须沿用相同幂等键和参数；重复请求返回 `result.applied: false`，同键不同参数返回 409。成功响应为 `{ success: true, result: { applied, ledgerId } }`。
