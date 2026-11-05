# 模型配置在线覆盖（进行中）

公共接口变更说明：`packages/jobs` 的模型配置类型与任务运行时读取方式。完成后并入 `docs/architecture.md` 并删除本文件。

## 1. 提示词类型

`segment.prompt` 与 `repair.prompt` 由函数改为模板对象：

```ts
type PromptTemplate<A> = {
  template: string; // 纯字符串，{{name}} 引用变量
  vars: (arg: A) => Record<string, string>; // 代码计算的变量（按槽位拼句等）
  required?: readonly string[]; // 模板中必须出现的占位符
};
// segment: PromptTemplate<Readonly<Record<string, string>>>  （arg = images）
// repair:  PromptTemplate<readonly string[]>                   （arg = slots）
```

- 渲染由 jobs 统一完成：替换 `{{name}}`；模板中出现未在 `vars` 返回值里的占位符视为配置错误。
- `slot.prep`（prep 提示词）仍是字符串。
- 站点默认模板渲染结果必须与改造前的函数逐字一致（测试锁定）。

## 2. 覆盖值

```ts
type ModelOverride = {
  enabled?: boolean;
  credits?: number; // 仅当代码里 credits 是数字时允许
  upstreamModel?: string;
  maxCost?: string;
  timeoutMinutes?: number;
  prep?: { upstreamModel?: string; maxCost?: string; prompt?: string };
  segments?: Record<
    string,
    {
      // key = segment id
      maxCost?: string;
      parameters?: Record<string, unknown>;
      promptTemplate?: string;
      repair?: { upstreamModel?: string; maxCost?: string; rounds?: number; promptTemplate?: string };
    }
  >;
};
```

不在白名单内的字段一律拒绝。合并后的模型走与 `serverModels` 相同的校验（分段 maxCost 之和 ≤ 模型 maxCost 等），另加：模板长度 ≤ 8000、只用已声明占位符、必填占位符齐全。

## 3. 存储（每站自己的 D1，表定义在 `packages/jobs/src/schema.ts`）

- `model_overrides(model_id TEXT PK, override_json TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)`
- `jobs.override_json TEXT NULL`：建任务时的覆盖值快照；null 表示按代码默认值。

## 4. 运行时语义

- 建任务：读一次覆盖值 → `effectiveModel(codeModel, override)` → 停用则拒绝 → 用生效模型计价扣费 → 快照与任务行在同一 D1 批次写入。
- runner 每一步用 `effectiveModel(codeModel, job.override_json)`，从不读当前 `model_overrides`，保证 Workflow 重放一致。
- 修改覆盖值不影响已建任务。

## 5. admin-rpc 新动作（站点端）

| action               | params                                   | result                                                                                                                                                                                                                                                     |
| -------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getModelConfig`     | —                                        | `{ models: Array<{ id, name, kind, defaults: ModelOverride（代码默认值，含默认模板）, override: ModelOverride \| null, version: number, placeholders: { segments: Record<segId, { prompt: string[]; repair?: string[] }> }, creditsEditable: boolean }> }` |
| `setModelOverride`   | `{ modelId, override, expectedVersion }` | `{ version }`；校验失败 400（`error` 为可读原因），版本不符 409，未知模型 404                                                                                                                                                                              |
| `clearModelOverride` | `{ modelId, expectedVersion }`           | `{ version }`；版本不符 409                                                                                                                                                                                                                                |

新建时 `expectedVersion` 为 0。

## 6. 定价

站点用白名单服务端函数返回 `{ id, credits, enabled }[]` 生效值；定价页和工具页用它显示价格、隐藏停用模型。
