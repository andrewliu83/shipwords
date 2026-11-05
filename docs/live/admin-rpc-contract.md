# 管理后台 RPC 接口变更

上游凭据动作（详见 [upstream-credentials.md](upstream-credentials.md)）：

- `listCredentials({})` → `{credentials: [{id,name,upstream,baseUrl,keyHint,isDefault,archivedAt,version,createdAt,updatedAt,modelCount,activeJobCount}]}`，不返回明文、密文或 IV。
- `createCredential({name,upstream,baseUrl?,apiKey})` → `{id,version}`；校验失败或缺失/无效 `CREDENTIALS_KEY` 返回 400。
- `updateCredential({id,expectedVersion,name?,baseUrl?,apiKey?})` → `{version}`；apiKey 缺省保留原 Key，baseUrl 为 null 恢复默认。错误 400/404/409。
- `archiveCredential({id,expectedVersion})` → `{version}`；未知 ID 404，版本冲突或当前被模型覆盖/站点默认引用返回 409（后者 error 为 `credential_in_use`）。归档不阻止在途任务使用。
- `setDefaultCredential({upstream,id})` → `{}`；id 为 null 取消默认。错误 400/404。
- 上述错误格式均为 `{error: string}`。`getModelConfig` 的每个模型增加 `upstream` 与 `credentialId`（当前覆盖值或 null）；`setModelOverride` 接受 `credentialId?: string | null`，不存在/归档/upstream 不符返回 400。

管理后台通过站点的 Service Binding 调用 `POST /api/admin-rpc`，并在 `x-admin-secret` 中提供站点配置的 `ADMIN_SECRET`。未配置或密钥不匹配时拒绝请求；Service Binding 本身不使 HTTP 路由私有。

查询请求使用 `{ action, params }`，可选分页参数 `limit` 为 1–200 的整数，`offset` 为非负安全整数。返回对象分别包含 `users`、`ledger`、`jobs`、`payments` 或 `quota` 数组。

`grantCredits` 的 `params` 必须包含 `userId`、`amount`、`reason` 和 `idemKey`。金额必须为正安全整数；字符串不能为空或带首尾空格，长度分别不超过 256、1000 和 128 字符。对同一操作的重试须沿用相同幂等键和参数；重复请求返回 `result.applied: false`，同键不同参数返回 409。成功响应为 `{ success: true, result: { applied, ledgerId } }`。

模型配置动作遵守 [model-overrides.md](model-overrides.md) §5：

- `getModelConfig` 无参数，返回 `{ models: [{ id, name, kind, defaults, override, version, placeholders: { segments: { [segmentId]: { prompt: string[], repair?: string[] } } }, creditsEditable }] }`。defaults 包含代码默认的可覆盖字段及模板，override 为当前覆盖或 null。
- `setModelOverride` 接受 `{ modelId, override, expectedVersion }`，返回 `{ version }`。初次写入 expectedVersion 为 0；校验失败返回 400（error 为可读原因），未知模型 404，版本冲突 409。
- `clearModelOverride` 接受 `{ modelId, expectedVersion }`，返回 `{ version }`。清除恢复代码默认，保留递增版本防止旧写入覆盖；版本冲突 409，未知模型 404。
