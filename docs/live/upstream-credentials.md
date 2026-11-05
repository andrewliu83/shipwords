# 上游凭据（后台管理 URL / API Key）

未完成工作的接口契约。上线后并入 `docs/architecture.md` §4/§7 与 `packages/jobs/SPEC.md`，然后删除本文件。

## 1. 规则变化

原规则：secrets 只来自 Worker `env`。新增一个例外：

- 上游 API Key 可以由后台写入站点 D1，**加密存储**。主密钥 `CREDENTIALS_KEY`（base64 编码的 32 字节）仍是 Worker secret。
- 明文 Key 只在 Worker 内存里出现：不写日志、不进错误信息、任何接口都不返回（只返回末 4 位 `keyHint`）、不作为 Workflow `step.do` 的返回值（step 结果会被持久化）。
- 没有配置凭据的站点继续用 `YIR_API_KEY` / `YIR_BASE_URL`，行为与现在相同。
- mock 模式（`UPSTREAM_MOCK`）优先级最高，忽略凭据；fail-closed 行为不变。

## 2. 存储（`packages/jobs/src/schema.ts`）

表 `upstream_credentials`：

| 列                          | 类型             | 说明                                          |
| --------------------------- | ---------------- | --------------------------------------------- |
| `id`                        | text PK          | `cred_` + 随机                                |
| `name`                      | text not null    | ≤ 100 字符                                    |
| `upstream`                  | text not null    | 当前只有 `'yir'`                              |
| `base_url`                  | text null        | null = 适配器默认地址                         |
| `key_ciphertext`            | text not null    | base64                                        |
| `key_iv`                    | text not null    | base64，12 字节                               |
| `key_hint`                  | text not null    | Key 末 4 位                                   |
| `is_default`                | integer bool     | 每个 upstream 最多一条为 true（部分唯一索引） |
| `version`                   | integer not null | 每次修改 +1，乐观并发                         |
| `created_at` / `updated_at` | integer          | 毫秒                                          |
| `archived_at`               | integer null     | 归档时间                                      |

`jobs` 新增 `credential_id text null`：建任务时解析并与任务行、扣费、`override_json` 快照同一批次写入。null = 使用 env。

模型覆盖（`ModelOverride`）新增模型级白名单字段 `credentialId?: string | null`（null/缺省 = 跟随站点默认）。

## 3. 加密（`packages/jobs/src/credentials.ts`）

- AES-256-GCM，WebCrypto；每次写入新的随机 12 字节 IV；AAD = 凭据 `id`。
- 修改 Key 时重新加密（新 IV）。
- `CREDENTIALS_KEY` 缺失或格式错误：创建/修改 Key 返回 400 `credentials_key_missing`。运行时凭据故障持久化为 `credential_unavailable` 失败；尚无真实上游任务时按现有规则退款，已有真实上游任务（不含 `skipped:` 占位符）则保留扣费和 guest 配额，后续重复结算、get/list 的 stale healing 均不能退款。

## 4. 解析顺序（建任务时一次）

1. 生效模型覆盖里的 `credentialId`
2. 该 upstream 的站点默认凭据
3. env（`credential_id` 写 null）

所选凭据必须存在、未归档、`upstream` 等于模型的 upstream，否则建任务返回错误且不扣费。

任务 INSERT 在执行时再次使用 SQL 可用性约束：若解析后凭据已归档、删除或 upstream 已不匹配，触发任务行 `upstream NOT NULL` 约束，令包含扣费的整个 D1 batch 回滚，返回 400 `invalid_credential`。guest 同样拒绝写入并返还已消费配额。env 回退（credential_id 为 null）不受此约束影响。

## 5. 运行时

- `RunnerDeps.adapters` 替换为 `adapterFor(job): Promise<UpstreamAdapter>`：按 `job.upstream` 与 `job.credential_id` 构造适配器；凭据在每个调用上游的 step 内部读取并解密（因此修改凭据后，在途任务的下一步使用新值）。
- 已归档的凭据仍可被已引用它的任务使用。
- D1 凭据的 baseUrl 为 null 时显式使用 SDK 导出的 `DEFAULT_GATEWAY_BASE_URL`（官方默认网关），不继承进程或 Worker 中的 `YIR_BASE_URL`；env 回退分支保留原行为。
- 只有决定任务结果的必要上游调用发生凭据故障时，才持久化 `credential_unavailable`。取消等尽力清理中的凭据错误不会改写普通失败或 timeout 的原因，也不会改变原本的退款/配额结算。
- 已提交后凭据故障保留扣费时，不发送现有的“积分已退回”失败邮件；通知与结算复用同一判定，所有语言一致跳过该邮件。正常退款失败仍发送原有文案。
- 凭据故障在上游调用所在的 step 内通过条件状态更新持久化，再抛出安全错误；识别兼容错误的 name/code/message，不仅依赖 `instanceof`。因此 Workflow 序列化错误、重试或重放不会丢失不退款判定。复用 `markFailed` / `settleFailure`，按最终 error_code 与真实 upstream_job_id 决定是否保留扣费，不新增金钱写入。
- 取消任务（`handlers.ts`）同样用 `job.credential_id`。
- 修改凭据的已知代价（用户已接受）：在途任务换了账号后可能查不到原上游任务，按现有超时/失败路径结束。

## 6. admin-rpc 新增 action

错误统一 `{error}` + 状态码，与现有 action 一致。

| action                 | params                                                                                             | 成功返回                                                                                                                         | 错误                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `listCredentials`      | `{}`                                                                                               | `{credentials: [{id,name,upstream,baseUrl,keyHint,isDefault,archivedAt,version,createdAt,updatedAt,modelCount,activeJobCount}]}` | —                                                         |
| `createCredential`     | `{name, upstream, baseUrl?, apiKey}`                                                               | `{id, version}`                                                                                                                  | 400                                                       |
| `updateCredential`     | `{id, expectedVersion, name?, baseUrl?, apiKey?}`（apiKey 缺省 = 不改；baseUrl `null` = 恢复默认） | `{version}`                                                                                                                      | 400/404/409                                               |
| `archiveCredential`    | `{id, expectedVersion}`                                                                            | `{version}`                                                                                                                      | 404/409（被模型覆盖或默认引用时 409 `credential_in_use`） |
| `setDefaultCredential` | `{upstream, id}`（id `null` = 取消默认）                                                           | `{}`                                                                                                                             | 400/404                                                   |

校验：`name` 非空 ≤ 100；`baseUrl` 必须 `https://`、≤ 512，可解析为 URL；`apiKey` 非空 ≤ 1024 且无首尾空白；`upstream` 为已知上游。`modelCount` = 当前覆盖引用数；`activeJobCount` = 引用它且状态为 queued/submitted 的任务数。

`getModelConfig` 每个模型增加 `credentialId`（覆盖值）和 `upstream`；`setModelOverride` 的 override 接受 `credentialId`，不存在/已归档/upstream 不符返回 400。
