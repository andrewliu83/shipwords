import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useId, useMemo, useRef, useState } from 'react';
import {
  type AdminModelConfigItem,
  clearModelOverride,
  getModelConfig,
  type ModelOverride,
  type PrepOverride,
  type SegmentOverride,
  type SegmentRepairOverride,
  setModelOverride,
} from '~/lib/site-rpc';
import { MANAGED_SITES, resolveSiteId } from '~/lib/sites';

interface SearchParams {
  siteId?: string;
  modelId?: string;
}

export const Route = createFileRoute('/models')({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    siteId: resolveSiteId(search.siteId),
    modelId: typeof search.modelId === 'string' ? search.modelId : undefined,
  }),
  loaderDeps: ({ search }) => ({
    siteId: search.siteId,
  }),
  loader: async ({
    deps,
  }): Promise<{
    models: AdminModelConfigItem[];
    activeSite: (typeof MANAGED_SITES)[number] | null;
    error: string | null;
  }> => {
    const activeSite = MANAGED_SITES.find((s) => s.id === deps.siteId) || MANAGED_SITES[0];
    if (!activeSite) return { models: [], activeSite: null, error: '未找到配置的站点' };

    try {
      const models = await getModelConfig({
        data: { siteId: activeSite.id },
      });
      return { models, activeSite, error: null };
    } catch (err: unknown) {
      return {
        models: [],
        activeSite,
        error: err instanceof Error ? err.message : '获取模型配置失败',
      };
    }
  },
  component: ModelsPage,
});

interface FormSegmentState {
  maxCost: string;
  parametersText: string;
  promptTemplate: string;
  repair?: {
    upstreamModel: string;
    maxCost: string;
    rounds: number | '';
    promptTemplate: string;
  };
}

interface ModelFormState {
  enabled: boolean;
  credits: number | '';
  upstreamModel: string;
  maxCost: string;
  timeoutMinutes: number | '';
  prep?: {
    upstreamModel: string;
    maxCost: string;
    prompt: string;
  };
  segments: Record<string, FormSegmentState>;
}

interface DiffItem {
  field: string;
  label: string;
  from: string;
  to: string;
}

function summarize(text: string, maxLen = 40): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

function validateJson(text: string): { valid: boolean; error?: string } {
  if (!text.trim()) return { valid: true };
  try {
    const val = JSON.parse(text);
    if (val === null || typeof val !== 'object' || Array.isArray(val)) {
      return { valid: false, error: '必须是 JSON 对象，例如 {"resolution": "720p"}' };
    }
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : 'JSON 语法错误' };
  }
}

function parseRpcError(err: unknown): { isConflict: boolean; message: string } {
  const errText = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;
  const isConflict = status === 409 || /\b409\b/.test(errText);
  if (isConflict) {
    return { isConflict: true, message: '配置已被修改，请刷新' };
  }
  const match = errText.match(/RPC failed with status \d+:\s*(.+)$/s);
  const serverReason = match ? match[1].trim() : errText;
  return { isConflict: false, message: serverReason };
}

function initFormState(model: AdminModelConfigItem): ModelFormState {
  const d = model.defaults;
  const o = model.override;

  const segKeys = Array.from(
    new Set([
      ...Object.keys(d.segments ?? {}),
      ...Object.keys(o?.segments ?? {}),
      ...Object.keys(model.placeholders?.segments ?? {}),
    ]),
  );

  const segments: Record<string, FormSegmentState> = {};
  for (const segId of segKeys) {
    const segDef = d.segments?.[segId];
    const segOvr = o?.segments?.[segId];

    let paramsText = '';
    if (segOvr?.parameters !== undefined) {
      paramsText = JSON.stringify(segOvr.parameters, null, 2);
    } else if (segDef?.parameters !== undefined) {
      paramsText = JSON.stringify(segDef.parameters, null, 2);
    }

    const hasRepair =
      segDef?.repair !== undefined ||
      segOvr?.repair !== undefined ||
      model.placeholders?.segments?.[segId]?.repair !== undefined;

    segments[segId] = {
      maxCost: segOvr?.maxCost ?? segDef?.maxCost ?? '',
      parametersText: paramsText,
      promptTemplate: segOvr?.promptTemplate ?? segDef?.promptTemplate ?? '',
      repair: hasRepair
        ? {
            upstreamModel: segOvr?.repair?.upstreamModel ?? segDef?.repair?.upstreamModel ?? '',
            maxCost: segOvr?.repair?.maxCost ?? segDef?.repair?.maxCost ?? '',
            rounds: segOvr?.repair?.rounds ?? segDef?.repair?.rounds ?? '',
            promptTemplate: segOvr?.repair?.promptTemplate ?? segDef?.repair?.promptTemplate ?? '',
          }
        : undefined,
    };
  }

  const hasPrep = d.prep !== undefined || o?.prep !== undefined;

  return {
    enabled: o?.enabled ?? d.enabled ?? true,
    credits: o?.credits ?? d.credits ?? '',
    upstreamModel: o?.upstreamModel ?? d.upstreamModel ?? '',
    maxCost: o?.maxCost ?? d.maxCost ?? '',
    timeoutMinutes: o?.timeoutMinutes ?? d.timeoutMinutes ?? '',
    prep: hasPrep
      ? {
          upstreamModel: o?.prep?.upstreamModel ?? d.prep?.upstreamModel ?? '',
          maxCost: o?.prep?.maxCost ?? d.prep?.maxCost ?? '',
          prompt: o?.prep?.prompt ?? d.prep?.prompt ?? '',
        }
      : undefined,
    segments,
  };
}

function computeDiff(
  form: ModelFormState,
  model: AdminModelConfigItem,
): { override: ModelOverride; diffItems: DiffItem[]; hasChanges: boolean } {
  const d = model.defaults;
  const diffItems: DiffItem[] = [];
  const override: ModelOverride = {};

  // 1. enabled
  const defaultEnabled = d.enabled ?? true;
  if (form.enabled !== defaultEnabled) {
    override.enabled = form.enabled;
    diffItems.push({
      field: 'enabled',
      label: '启用状态',
      from: defaultEnabled ? '启用' : '停用',
      to: form.enabled ? '启用' : '停用',
    });
  }

  // 2. credits
  if (model.creditsEditable && form.credits !== '') {
    const numCredits = Number(form.credits);
    if (d.credits !== numCredits) {
      override.credits = numCredits;
      diffItems.push({
        field: 'credits',
        label: '积分价格',
        from: d.credits !== undefined ? `${d.credits} 积分` : '未设置',
        to: `${numCredits} 积分`,
      });
    }
  }

  // 3. upstreamModel
  const defaultUpstream = (d.upstreamModel ?? '').trim();
  const formUpstream = form.upstreamModel.trim();
  if (formUpstream !== defaultUpstream) {
    override.upstreamModel = formUpstream;
    diffItems.push({
      field: 'upstreamModel',
      label: '上游模型',
      from: defaultUpstream || '（空）',
      to: formUpstream || '（空）',
    });
  }

  // 4. maxCost
  const defaultMaxCost = (d.maxCost ?? '').trim();
  const formMaxCost = form.maxCost.trim();
  if (formMaxCost !== defaultMaxCost) {
    override.maxCost = formMaxCost;
    diffItems.push({
      field: 'maxCost',
      label: '费用上限',
      from: defaultMaxCost || '（空）',
      to: formMaxCost || '（空）',
    });
  }

  // 5. timeoutMinutes
  const defaultTimeout = d.timeoutMinutes;
  const formTimeout = form.timeoutMinutes === '' ? undefined : Number(form.timeoutMinutes);
  if (formTimeout !== undefined && formTimeout !== defaultTimeout) {
    override.timeoutMinutes = formTimeout;
    diffItems.push({
      field: 'timeoutMinutes',
      label: '超时时间',
      from: defaultTimeout !== undefined ? `${defaultTimeout} 分钟` : '（未设置）',
      to: `${formTimeout} 分钟`,
    });
  }

  // 6. prep
  if (form.prep) {
    const diffPrep: PrepOverride = {};
    const defaultPrepUpstream = (d.prep?.upstreamModel ?? '').trim();
    const formPrepUpstream = form.prep.upstreamModel.trim();
    if (formPrepUpstream !== defaultPrepUpstream) {
      diffPrep.upstreamModel = formPrepUpstream;
      diffItems.push({
        field: 'prep.upstreamModel',
        label: 'Prep 上游模型',
        from: defaultPrepUpstream || '（空）',
        to: formPrepUpstream || '（空）',
      });
    }

    const defaultPrepCost = (d.prep?.maxCost ?? '').trim();
    const formPrepCost = form.prep.maxCost.trim();
    if (formPrepCost !== defaultPrepCost) {
      diffPrep.maxCost = formPrepCost;
      diffItems.push({
        field: 'prep.maxCost',
        label: 'Prep 费用上限',
        from: defaultPrepCost || '（空）',
        to: formPrepCost || '（空）',
      });
    }

    const defaultPrepPrompt = (d.prep?.prompt ?? '').trim();
    const formPrepPrompt = form.prep.prompt.trim();
    if (formPrepPrompt !== defaultPrepPrompt) {
      diffPrep.prompt = form.prep.prompt;
      diffItems.push({
        field: 'prep.prompt',
        label: 'Prep 提示词',
        from: defaultPrepPrompt ? summarize(defaultPrepPrompt) : '（空）',
        to: formPrepPrompt ? summarize(formPrepPrompt) : '（空）',
      });
    }

    if (Object.keys(diffPrep).length > 0) {
      override.prep = diffPrep;
    }
  }

  // 7. segments
  const diffSegments: Record<string, SegmentOverride> = {};
  for (const [segId, segForm] of Object.entries(form.segments)) {
    const segDefault = d.segments?.[segId];
    const diffSeg: SegmentOverride = {};

    const defaultSegCost = (segDefault?.maxCost ?? '').trim();
    const formSegCost = segForm.maxCost.trim();
    if (formSegCost !== defaultSegCost) {
      diffSeg.maxCost = formSegCost;
      diffItems.push({
        field: `segments.${segId}.maxCost`,
        label: `分段 [${segId}] 费用上限`,
        from: defaultSegCost || '（空）',
        to: formSegCost || '（空）',
      });
    }

    // parameters
    if (segForm.parametersText.trim()) {
      try {
        const parsed = JSON.parse(segForm.parametersText);
        const normDef = JSON.stringify(sortObjectKeys(segDefault?.parameters ?? {}));
        const normForm = JSON.stringify(sortObjectKeys(parsed));
        if (normForm !== normDef) {
          diffSeg.parameters = parsed;
          diffItems.push({
            field: `segments.${segId}.parameters`,
            label: `分段 [${segId}] 参数`,
            from: normDef,
            to: normForm,
          });
        }
      } catch {
        // Handled by validation check
      }
    } else if (segDefault?.parameters && Object.keys(segDefault.parameters).length > 0) {
      diffSeg.parameters = {};
      diffItems.push({
        field: `segments.${segId}.parameters`,
        label: `分段 [${segId}] 参数`,
        from: JSON.stringify(sortObjectKeys(segDefault.parameters)),
        to: '{}',
      });
    }

    // promptTemplate
    const defaultTemplate = (segDefault?.promptTemplate ?? '').trim();
    const formTemplate = segForm.promptTemplate.trim();
    if (formTemplate !== defaultTemplate) {
      diffSeg.promptTemplate = segForm.promptTemplate;
      diffItems.push({
        field: `segments.${segId}.promptTemplate`,
        label: `分段 [${segId}] 提示词模板`,
        from: defaultTemplate ? summarize(defaultTemplate) : '（空）',
        to: formTemplate ? summarize(formTemplate) : '（空）',
      });
    }

    // repair
    if (segForm.repair) {
      const diffRepair: SegmentRepairOverride = {};
      const repairDefault = segDefault?.repair;

      const defRepairUpstream = (repairDefault?.upstreamModel ?? '').trim();
      const formRepairUpstream = segForm.repair.upstreamModel.trim();
      if (formRepairUpstream !== defRepairUpstream) {
        diffRepair.upstreamModel = formRepairUpstream;
        diffItems.push({
          field: `segments.${segId}.repair.upstreamModel`,
          label: `分段 [${segId}] 修复上游模型`,
          from: defRepairUpstream || '（空）',
          to: formRepairUpstream || '（空）',
        });
      }

      const defRepairCost = (repairDefault?.maxCost ?? '').trim();
      const formRepairCost = segForm.repair.maxCost.trim();
      if (formRepairCost !== defRepairCost) {
        diffRepair.maxCost = formRepairCost;
        diffItems.push({
          field: `segments.${segId}.repair.maxCost`,
          label: `分段 [${segId}] 修复费用上限`,
          from: defRepairCost || '（空）',
          to: formRepairCost || '（空）',
        });
      }

      const defRounds = repairDefault?.rounds;
      const formRounds = segForm.repair.rounds === '' ? undefined : Number(segForm.repair.rounds);
      if (formRounds !== undefined && formRounds !== defRounds) {
        diffRepair.rounds = formRounds;
        diffItems.push({
          field: `segments.${segId}.repair.rounds`,
          label: `分段 [${segId}] 修复轮数`,
          from: defRounds !== undefined ? `${defRounds} 轮` : '（未设置）',
          to: `${formRounds} 轮`,
        });
      }

      const defRepairTemplate = (repairDefault?.promptTemplate ?? '').trim();
      const formRepairTemplate = segForm.repair.promptTemplate.trim();
      if (formRepairTemplate !== defRepairTemplate) {
        diffRepair.promptTemplate = segForm.repair.promptTemplate;
        diffItems.push({
          field: `segments.${segId}.repair.promptTemplate`,
          label: `分段 [${segId}] 修复提示词模板`,
          from: defRepairTemplate ? summarize(defRepairTemplate) : '（空）',
          to: formRepairTemplate ? summarize(formRepairTemplate) : '（空）',
        });
      }

      if (Object.keys(diffRepair).length > 0) {
        diffSeg.repair = diffRepair;
      }
    }

    if (Object.keys(diffSeg).length > 0) {
      diffSegments[segId] = diffSeg;
    }
  }

  if (Object.keys(diffSegments).length > 0) {
    override.segments = diffSegments;
  }

  return {
    override,
    diffItems,
    hasChanges: diffItems.length > 0,
  };
}

function ModelsPage() {
  const { models, activeSite, error } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();

  const [selectedModelId, setSelectedModelId] = useState<string | null>(
    search.modelId ?? models[0]?.id ?? null,
  );

  const activeModel = models.find((m) => m.id === selectedModelId) ?? models[0] ?? null;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* 头部标题与站点切换 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">模型配置</h1>
          <p className="text-sm text-slate-400 mt-1">
            在线覆盖 AI 模型参数、上游模型、费用上限及提示词模板（仅提交与代码默认值不同的字段）
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="site-select" className="text-xs text-slate-400">
            选择站点:
          </label>
          <select
            id="site-select"
            value={search.siteId}
            onChange={(e) => {
              navigate({ search: { siteId: e.target.value } });
            }}
            className="bg-slate-900 border border-slate-700 text-sm text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
          >
            {MANAGED_SITES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 text-sm">
          {error}
        </div>
      )}

      {models.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center text-slate-500">
          <p className="text-base font-medium text-slate-400">暂无可用模型配置</p>
          <p className="text-xs text-slate-500 mt-1">当前受管站点未上报模型或 RPC 尚未返回模型列表</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 模型选项卡 / 列表卡片 */}
          <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-4">
            {models.map((m) => {
              const isSelected = activeModel?.id === m.id;
              const hasOverride = m.override !== null;
              const isEnabled = m.override?.enabled ?? m.defaults.enabled ?? true;

              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedModelId(m.id)}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'bg-slate-900 border-indigo-500/80 shadow-lg shadow-indigo-950/40 ring-1 ring-indigo-500/30'
                      : 'bg-slate-900/40 border-slate-800 hover:border-slate-700 hover:bg-slate-900/80'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-white">{m.name}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                        {m.kind}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-slate-400 mt-0.5">{m.id}</div>
                  </div>

                  <div className="flex flex-col items-end gap-1 ml-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono border ${
                        isEnabled
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      }`}
                    >
                      {isEnabled ? '● 启用' : '○ 停用'}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                        hasOverride
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : 'bg-slate-800/80 text-slate-400 border border-slate-700/60'
                      }`}
                    >
                      {hasOverride ? `已覆盖 v${m.version}` : '代码默认'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {activeModel && (
            <ModelEditor
              key={`${activeModel.id}-v${activeModel.version}`}
              model={activeModel}
              siteId={activeSite?.id || ''}
              onRefresh={() => router.invalidate()}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface ModelEditorProps {
  model: AdminModelConfigItem;
  siteId: string;
  onRefresh: () => Promise<void>;
}

function ModelEditor({ model, siteId, onRefresh }: ModelEditorProps) {
  const [form, setForm] = useState<ModelFormState>(() => initFormState(model));
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<{ isConflict: boolean; message: string } | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);

  // Textarea refs for inserting placeholders
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Compute live diff
  const diff = useMemo(() => computeDiff(form, model), [form, model]);

  // Check JSON validation across all segments
  const jsonErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const [segId, seg] of Object.entries(form.segments)) {
      const v = validateJson(seg.parametersText);
      if (!v.valid && v.error) {
        errors[segId] = v.error;
      }
    }
    return errors;
  }, [form.segments]);

  const hasJsonErrors = Object.keys(jsonErrors).length > 0;

  // Insert placeholder helper
  const handleInsertPlaceholder = (key: string, placeholder: string, currentVal: string) => {
    const el = textareaRefs.current[key];
    const tag = `{{${placeholder}}}`;
    if (!el) return;
    const start = el.selectionStart ?? currentVal.length;
    const end = el.selectionEnd ?? currentVal.length;
    const nextVal = currentVal.slice(0, start) + tag + currentVal.slice(end);

    if (key === 'prep.prompt' && form.prep) {
      setForm((prev) => ({
        ...prev,
        prep: prev.prep ? { ...prev.prep, prompt: nextVal } : undefined,
      }));
    } else if (key.startsWith('seg.prompt.')) {
      const segId = key.replace('seg.prompt.', '');
      setForm((prev) => ({
        ...prev,
        segments: {
          ...prev.segments,
          [segId]: { ...prev.segments[segId]!, promptTemplate: nextVal },
        },
      }));
    } else if (key.startsWith('seg.repair.')) {
      const segId = key.replace('seg.repair.', '');
      setForm((prev) => ({
        ...prev,
        segments: {
          ...prev.segments,
          [segId]: {
            ...prev.segments[segId]!,
            repair: prev.segments[segId]?.repair
              ? { ...prev.segments[segId]!.repair!, promptTemplate: nextVal }
              : undefined,
          },
        },
      }));
    }

    setTimeout(() => {
      el.focus();
      const cursor = start + tag.length;
      el.setSelectionRange(cursor, cursor);
    }, 0);
  };

  // Submit save
  const handleSaveConfirm = async () => {
    if (submitting || hasJsonErrors) return;
    setSubmitting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await setModelOverride({
        data: {
          siteId,
          modelId: model.id,
          override: diff.override,
          expectedVersion: model.version,
        },
      });
      setShowSaveModal(false);
      setActionSuccess(`模型「${model.name}」配置已成功保存！新版本号: v${res.version}`);
      await onRefresh();
    } catch (err: unknown) {
      const parsed = parseRpcError(err);
      setActionError(parsed);
      setShowSaveModal(false);
    } finally {
      setSubmitting(false);
    }
  };

  // Submit clear
  const handleClearConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await clearModelOverride({
        data: {
          siteId,
          modelId: model.id,
          expectedVersion: model.version,
        },
      });
      setShowClearModal(false);
      setActionSuccess(
        `已清除模型「${model.name}」的全部在线覆盖，恢复为代码默认值！新版本号: v${res.version}`,
      );
      await onRefresh();
    } catch (err: unknown) {
      const parsed = parseRpcError(err);
      setActionError(parsed);
      setShowClearModal(false);
    } finally {
      setSubmitting(false);
    }
  };

  const hasOverride = model.override !== null;

  return (
    <div className="space-y-6">
      {/* 状态与通知栏 */}
      {actionSuccess && (
        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm flex items-center justify-between">
          <span>{actionSuccess}</span>
          <button
            type="button"
            onClick={() => setActionSuccess(null)}
            className="text-emerald-400 hover:text-emerald-200 text-xs ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {actionError && (
        <div
          className={`p-4 rounded-xl border text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            actionError.isConflict
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{actionError.isConflict ? '⚠️' : '❌'}</span>
            <span className="font-medium">{actionError.message}</span>
          </div>

          {actionError.isConflict && (
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                onRefresh();
              }}
              className="px-3 py-1.5 text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 rounded-lg transition-colors whitespace-nowrap self-start sm:self-auto"
            >
              立即刷新配置
            </button>
          )}
        </div>
      )}

      {/* 模型概览条 */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-white text-lg">{model.name}</span>
          <span className="text-xs font-mono text-slate-400 bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
            {model.id}
          </span>
          <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            {model.kind}
          </span>
          <span className="text-xs font-mono text-slate-400">
            当前版本: <span className="text-indigo-400 font-semibold">v{model.version}</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {hasOverride ? (
            <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-purple-500/10 text-purple-300 border border-purple-500/20">
              ● 已生效在线覆盖
            </span>
          ) : (
            <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-slate-800 text-slate-400 border border-slate-700">
              ○ 当前按代码默认值运行
            </span>
          )}

          {hasOverride && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => setShowClearModal(true)}
              className="px-3 py-1 text-xs font-medium bg-rose-600/10 hover:bg-rose-600/20 text-rose-300 border border-rose-500/30 rounded-lg transition-colors disabled:opacity-50"
            >
              清除覆盖，恢复默认
            </button>
          )}
        </div>
      </div>

      {/* 1. 模型级基础配置 */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div>
            <h2 className="text-base font-semibold text-white">模型级参数</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              控制模型全局上下线状态、计价、上游模型名、总限价与超时
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400">白名单字段</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* 启用状态 */}
          <div>
            <label htmlFor="model-enabled-select" className="block text-xs font-medium text-slate-300 mb-1.5">
              启用状态 (enabled)
            </label>
            <select
              id="model-enabled-select"
              value={form.enabled ? 'true' : 'false'}
              onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.value === 'true' }))}
              className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            >
              <option value="true">启用 (True)</option>
              <option value="false">停用 (False)</option>
            </select>
            <div className="flex items-center justify-between mt-1 text-[11px] text-slate-400">
              <span>代码默认: {(model.defaults.enabled ?? true) ? '启用' : '停用'}</span>
              {model.override?.enabled !== undefined && (
                <span className="text-purple-400 font-mono">
                  当前覆盖: {model.override.enabled ? '启用' : '停用'}
                </span>
              )}
            </div>
          </div>

          {/* 积分价格 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="model-credits-input" className="text-xs font-medium text-slate-300">
                积分价格 (credits)
              </label>
              {!model.creditsEditable && (
                <span className="text-[11px] text-amber-400/90 font-mono">🔒 代码动态函数</span>
              )}
            </div>
            <input
              id="model-credits-input"
              type="number"
              min="0"
              disabled={!model.creditsEditable || submitting}
              value={form.credits}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  credits: e.target.value === '' ? '' : Number(e.target.value),
                }))
              }
              placeholder={model.creditsEditable ? '如 50' : '动态函数计价'}
              className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:bg-slate-900/50 font-mono"
            />
            <div className="mt-1 text-[11px] text-slate-400">
              {!model.creditsEditable ? (
                <span className="text-amber-400/80">代码中定价为动态计算函数，不可在线覆盖</span>
              ) : (
                <div className="flex items-center justify-between">
                  <span>
                    代码默认:{' '}
                    {model.defaults.credits !== undefined ? `${model.defaults.credits} 积分` : '未设置'}
                  </span>
                  {model.override?.credits !== undefined && (
                    <span className="text-purple-400 font-mono">当前覆盖: {model.override.credits} 积分</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 上游模型 */}
          <div>
            <label htmlFor="model-upstream-input" className="block text-xs font-medium text-slate-300 mb-1.5">
              上游模型 (upstreamModel)
            </label>
            <input
              id="model-upstream-input"
              type="text"
              value={form.upstreamModel}
              onChange={(e) => setForm((prev) => ({ ...prev, upstreamModel: e.target.value }))}
              placeholder="如 klingai/kling-4.0"
              className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 font-mono"
            />
            <div className="flex items-center justify-between mt-1 text-[11px] text-slate-400">
              <span>代码默认: {model.defaults.upstreamModel || '（未设置）'}</span>
              {model.override?.upstreamModel && (
                <span className="text-purple-400 font-mono truncate max-w-[150px]">
                  覆盖: {model.override.upstreamModel}
                </span>
              )}
            </div>
          </div>

          {/* 费用上限 */}
          <div>
            <label htmlFor="model-maxcost-input" className="block text-xs font-medium text-slate-300 mb-1.5">
              费用上限 (maxCost)
            </label>
            <input
              id="model-maxcost-input"
              type="text"
              value={form.maxCost}
              onChange={(e) => setForm((prev) => ({ ...prev, maxCost: e.target.value }))}
              placeholder="如 5.60"
              className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 font-mono"
            />
            <div className="flex items-center justify-between mt-1 text-[11px] text-slate-400">
              <span>代码默认: {model.defaults.maxCost || '（未设置）'}</span>
              {model.override?.maxCost && (
                <span className="text-purple-400 font-mono">覆盖: {model.override.maxCost}</span>
              )}
            </div>
          </div>

          {/* 超时分钟数 */}
          <div>
            <label htmlFor="model-timeout-input" className="block text-xs font-medium text-slate-300 mb-1.5">
              任务超时时间 (timeoutMinutes, 分钟)
            </label>
            <input
              id="model-timeout-input"
              type="number"
              min="1"
              value={form.timeoutMinutes}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  timeoutMinutes: e.target.value === '' ? '' : Number(e.target.value),
                }))
              }
              placeholder="如 45"
              className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 font-mono"
            />
            <div className="flex items-center justify-between mt-1 text-[11px] text-slate-400">
              <span>
                代码默认:{' '}
                {model.defaults.timeoutMinutes !== undefined
                  ? `${model.defaults.timeoutMinutes} 分钟`
                  : '（未设置）'}
              </span>
              {model.override?.timeoutMinutes !== undefined && (
                <span className="text-purple-400 font-mono">覆盖: {model.override.timeoutMinutes} 分钟</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Prep 预处理阶段 */}
      {form.prep && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <span>Prep 预处理阶段</span>
                <span className="text-xs font-normal text-slate-400 font-mono">(prep)</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">用于参考图前置清洗、面部遮蔽或标准化等准备工作</p>
            </div>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
              纯字符串提示词
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="prep-upstream-input"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Prep 上游模型 (upstreamModel)
              </label>
              <input
                id="prep-upstream-input"
                type="text"
                value={form.prep.upstreamModel}
                onChange={(e) => {
                  const val = e.target.value;
                  setForm((prev) => ({
                    ...prev,
                    prep: prev.prep ? { ...prev.prep, upstreamModel: val } : undefined,
                  }));
                }}
                placeholder="如 openai/gpt-image-2.5-sunburst"
                className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <div className="mt-1 text-[11px] text-slate-400">
                代码默认: {model.defaults.prep?.upstreamModel || '（未设置）'}
              </div>
            </div>

            <div>
              <label htmlFor="prep-maxcost-input" className="block text-xs font-medium text-slate-300 mb-1.5">
                Prep 费用上限 (maxCost)
              </label>
              <input
                id="prep-maxcost-input"
                type="text"
                value={form.prep.maxCost}
                onChange={(e) => {
                  const val = e.target.value;
                  setForm((prev) => ({
                    ...prev,
                    prep: prev.prep ? { ...prev.prep, maxCost: val } : undefined,
                  }));
                }}
                placeholder="如 0.02"
                className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <div className="mt-1 text-[11px] text-slate-400">
                代码默认: {model.defaults.prep?.maxCost || '（未设置）'}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="prep-prompt-textarea" className="text-xs font-medium text-slate-300">
                Prep 提示词 (prompt)
              </label>
              <span className="text-[11px] text-slate-400">{form.prep.prompt.length} 字符</span>
            </div>
            <textarea
              id="prep-prompt-textarea"
              ref={(el) => {
                textareaRefs.current['prep.prompt'] = el;
              }}
              rows={4}
              value={form.prep.prompt}
              onChange={(e) => {
                const val = e.target.value;
                setForm((prev) => ({
                  ...prev,
                  prep: prev.prep ? { ...prev.prep, prompt: val } : undefined,
                }));
              }}
              placeholder="输入 Prep 预处理提示词..."
              className="w-full bg-slate-950 border border-slate-700 text-xs text-white rounded-lg p-3 focus:outline-none focus:border-indigo-500 font-mono leading-relaxed"
            />
            {model.defaults.prep?.prompt && (
              <details className="mt-2 text-xs text-slate-400">
                <summary className="cursor-pointer hover:text-slate-300">查看代码默认 Prep 提示词</summary>
                <div className="mt-1 p-3 rounded bg-slate-950 border border-slate-800 text-[11px] font-mono whitespace-pre-wrap max-h-40 overflow-y-auto text-slate-400">
                  {model.defaults.prep.prompt}
                </div>
              </details>
            )}
          </div>
        </div>
      )}

      {/* 3. 分段与修复配置 (Segments) */}
      <div className="space-y-5">
        <div className="border-b border-slate-800/80 pb-3">
          <h2 className="text-base font-semibold text-white">视频分段与修复配置 (Segments)</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            配置各生成分段的费用上限、参数 (parameters JSON)、模板占位符与修复 (repair) 轮数
          </p>
        </div>

        {Object.entries(form.segments).map(([segId, seg]) => {
          const segPlaceholders = model.placeholders.segments[segId];
          const segDef = model.defaults.segments?.[segId];
          const jsonErr = jsonErrors[segId];

          return (
            <div key={segId} className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                  <h3 className="text-sm font-semibold text-white">
                    分段: <span className="font-mono text-indigo-300">{segId}</span>
                  </h3>
                </div>
                <span className="text-xs font-mono text-slate-400">段 ID: {segId}</span>
              </div>

              {/* 分段 maxCost */}
              <div className="max-w-xs">
                <label
                  htmlFor={`segment-${segId}-maxcost`}
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  分段费用上限 (maxCost)
                </label>
                <input
                  id={`segment-${segId}-maxcost`}
                  type="text"
                  value={seg.maxCost}
                  onChange={(e) => {
                    const val = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      segments: {
                        ...prev.segments,
                        [segId]: { ...prev.segments[segId]!, maxCost: val },
                      },
                    }));
                  }}
                  placeholder="如 3.40"
                  className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 font-mono"
                />
                <div className="mt-1 text-[11px] text-slate-400">
                  代码默认: {segDef?.maxCost || '（未设置）'}
                </div>
              </div>

              {/* 分段 parameters (JSON) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor={`segment-${segId}-parameters`}
                    className="text-xs font-medium text-slate-300 flex items-center gap-2"
                  >
                    <span>生成参数 (parameters JSON)</span>
                    <span className="text-[11px] font-normal text-slate-400">
                      （前端做 JSON 语法与对象校验）
                    </span>
                  </label>
                  {jsonErr ? (
                    <span className="text-xs text-rose-400 font-mono">❌ {jsonErr}</span>
                  ) : (
                    <span className="text-xs text-emerald-400 font-mono">✓ JSON 格式正确</span>
                  )}
                </div>
                <textarea
                  id={`segment-${segId}-parameters`}
                  rows={4}
                  value={seg.parametersText}
                  onChange={(e) => {
                    const val = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      segments: {
                        ...prev.segments,
                        [segId]: { ...prev.segments[segId]!, parametersText: val },
                      },
                    }));
                  }}
                  placeholder='{"duration": 18, "resolution": "720p", "aspect_ratio": "auto"}'
                  className={`w-full bg-slate-950 border text-xs text-white rounded-lg p-3 focus:outline-none font-mono ${
                    jsonErr
                      ? 'border-rose-500 focus:border-rose-500'
                      : 'border-slate-700 focus:border-indigo-500'
                  }`}
                />
              </div>

              {/* 提示词模板与占位符工具栏 */}
              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <label
                    htmlFor={`segment-${segId}-prompt-template`}
                    className="text-xs font-medium text-slate-300"
                  >
                    提示词模板 (promptTemplate)
                  </label>
                  <span className="text-[11px] text-slate-400">
                    {seg.promptTemplate.length} 字符（上限 8000）
                  </span>
                </div>

                {/* 占位符工具栏 */}
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-slate-400">可用占位符 (点击插入光标处):</span>
                  {segPlaceholders?.prompt && segPlaceholders.prompt.length > 0 ? (
                    segPlaceholders.prompt.map((ph) => (
                      <button
                        key={ph}
                        type="button"
                        onClick={() => handleInsertPlaceholder(`seg.prompt.${segId}`, ph, seg.promptTemplate)}
                        className="px-2 py-0.5 text-xs font-mono bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 hover:text-white border border-indigo-500/30 rounded transition-colors"
                      >
                        + {`{{${ph}}}`}
                      </button>
                    ))
                  ) : (
                    <span className="text-xs text-slate-500">（无可用占位符）</span>
                  )}
                </div>

                <textarea
                  id={`segment-${segId}-prompt-template`}
                  ref={(el) => {
                    textareaRefs.current[`seg.prompt.${segId}`] = el;
                  }}
                  rows={6}
                  value={seg.promptTemplate}
                  onChange={(e) => {
                    const val = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      segments: {
                        ...prev.segments,
                        [segId]: { ...prev.segments[segId]!, promptTemplate: val },
                      },
                    }));
                  }}
                  placeholder="输入提示词模板，如 Edit @video_1. {{swaps}}..."
                  className="w-full bg-slate-950 border border-slate-700 text-xs text-white rounded-lg p-3 focus:outline-none focus:border-indigo-500 font-mono leading-relaxed"
                />

                {segDef?.promptTemplate && (
                  <details className="mt-2 text-xs text-slate-400">
                    <summary className="cursor-pointer hover:text-slate-300">查看代码默认提示词模板</summary>
                    <div className="mt-1 p-3 rounded bg-slate-950 border border-slate-800 text-[11px] font-mono whitespace-pre-wrap max-h-40 overflow-y-auto text-slate-400">
                      {segDef.promptTemplate}
                    </div>
                  </details>
                )}
              </div>

              {/* 修复阶段 (Repair) */}
              {seg.repair && (
                <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-4 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
                    <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <span>🛠️ 修复阶段配置 (repair)</span>
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">针对未命中槽位的补充微调</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label
                        htmlFor={`segment-${segId}-repair-upstream`}
                        className="block text-xs font-medium text-slate-300 mb-1"
                      >
                        修复上游模型 (upstreamModel)
                      </label>
                      <input
                        id={`segment-${segId}-repair-upstream`}
                        type="text"
                        value={seg.repair.upstreamModel}
                        onChange={(e) => {
                          const val = e.target.value;
                          setForm((prev) => ({
                            ...prev,
                            segments: {
                              ...prev.segments,
                              [segId]: {
                                ...prev.segments[segId]!,
                                repair: prev.segments[segId]?.repair
                                  ? { ...prev.segments[segId]!.repair!, upstreamModel: val }
                                  : undefined,
                              },
                            },
                          }));
                        }}
                        placeholder="如 pruna/p-video-replace"
                        className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`segment-${segId}-repair-maxcost`}
                        className="block text-xs font-medium text-slate-300 mb-1"
                      >
                        修复单轮费用上限 (maxCost)
                      </label>
                      <input
                        id={`segment-${segId}-repair-maxcost`}
                        type="text"
                        value={seg.repair.maxCost}
                        onChange={(e) => {
                          const val = e.target.value;
                          setForm((prev) => ({
                            ...prev,
                            segments: {
                              ...prev.segments,
                              [segId]: {
                                ...prev.segments[segId]!,
                                repair: prev.segments[segId]?.repair
                                  ? { ...prev.segments[segId]!.repair!, maxCost: val }
                                  : undefined,
                              },
                            },
                          }));
                        }}
                        placeholder="如 0.40"
                        className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`segment-${segId}-repair-rounds`}
                        className="block text-xs font-medium text-slate-300 mb-1"
                      >
                        修复轮数 (rounds)
                      </label>
                      <input
                        id={`segment-${segId}-repair-rounds`}
                        type="number"
                        min="1"
                        max="20"
                        value={seg.repair.rounds}
                        onChange={(e) => {
                          const val = e.target.value === '' ? '' : Number(e.target.value);
                          setForm((prev) => ({
                            ...prev,
                            segments: {
                              ...prev.segments,
                              [segId]: {
                                ...prev.segments[segId]!,
                                repair: prev.segments[segId]?.repair
                                  ? { ...prev.segments[segId]!.repair!, rounds: val }
                                  : undefined,
                              },
                            },
                          }));
                        }}
                        placeholder="如 5"
                        className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label
                        htmlFor={`segment-${segId}-repair-template`}
                        className="text-xs font-medium text-slate-300"
                      >
                        修复提示词模板 (promptTemplate)
                      </label>
                      <span className="text-[11px] text-slate-400">
                        {seg.repair.promptTemplate.length} 字符
                      </span>
                    </div>

                    {/* 修复占位符工具栏 */}
                    <div className="p-2 rounded bg-slate-900 border border-slate-800 flex flex-wrap items-center gap-2 mb-2">
                      <span className="text-[11px] text-slate-400">可用占位符:</span>
                      {segPlaceholders?.repair && segPlaceholders.repair.length > 0 ? (
                        segPlaceholders.repair.map((ph) => (
                          <button
                            key={ph}
                            type="button"
                            onClick={() =>
                              handleInsertPlaceholder(
                                `seg.repair.${segId}`,
                                ph,
                                seg.repair?.promptTemplate ?? '',
                              )
                            }
                            className="px-2 py-0.5 text-xs font-mono bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 hover:text-white border border-purple-500/30 rounded transition-colors"
                          >
                            + {`{{${ph}}}`}
                          </button>
                        ))
                      ) : (
                        <span className="text-xs text-slate-500">（无可用占位符）</span>
                      )}
                    </div>

                    <textarea
                      id={`segment-${segId}-repair-template`}
                      ref={(el) => {
                        textareaRefs.current[`seg.repair.${segId}`] = el;
                      }}
                      rows={3}
                      value={seg.repair.promptTemplate}
                      onChange={(e) => {
                        const val = e.target.value;
                        setForm((prev) => ({
                          ...prev,
                          segments: {
                            ...prev.segments,
                            [segId]: {
                              ...prev.segments[segId]!,
                              repair: prev.segments[segId]?.repair
                                ? { ...prev.segments[segId]!.repair!, promptTemplate: val }
                                : undefined,
                            },
                          },
                        }));
                      }}
                      placeholder="输入修复提示词模板，如 {{targets}} {{keep}}..."
                      className="w-full bg-slate-950 border border-slate-700 text-xs text-white rounded-lg p-2.5 focus:outline-none focus:border-indigo-500 font-mono leading-relaxed"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 底部保存与差异操作栏 */}
      <div className="sticky bottom-6 rounded-xl border border-slate-700 bg-slate-900/90 backdrop-blur-md p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-300">
            {diff.hasChanges ? (
              <span className="flex items-center gap-1.5 text-amber-300">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                检测到 <span className="font-bold">{diff.diffItems.length}</span> 项待提交修改
              </span>
            ) : (
              <span className="text-slate-400">当前表单与代码默认值一致（无待提交修改）</span>
            )}
          </div>
          {hasJsonErrors && (
            <span className="text-xs text-rose-400 font-medium">⚠️ 存在未修复的 JSON 错误</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={submitting}
            onClick={() => setForm(initFormState(model))}
            className="px-3 py-2 text-xs font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            重置表单
          </button>

          <button
            type="button"
            disabled={submitting || hasJsonErrors}
            onClick={() => setShowSaveModal(true)}
            className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-lg shadow-indigo-600/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            保存配置覆盖
          </button>
        </div>
      </div>

      {/* 保存前差异确认模态框 */}
      {showSaveModal && (
        <SaveDiffModal
          model={model}
          diff={diff}
          submitting={submitting}
          onClose={() => setShowSaveModal(false)}
          onConfirm={handleSaveConfirm}
        />
      )}

      {/* 清除覆盖确认模态框 */}
      {showClearModal && (
        <ClearConfirmModal
          model={model}
          submitting={submitting}
          onClose={() => setShowClearModal(false)}
          onConfirm={handleClearConfirm}
        />
      )}
    </div>
  );
}

interface SaveDiffModalProps {
  model: AdminModelConfigItem;
  diff: { override: ModelOverride; diffItems: DiffItem[]; hasChanges: boolean };
  submitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function SaveDiffModal({ model, diff, submitting, onClose, onConfirm }: SaveDiffModalProps) {
  const titleId = useId();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 my-8">
        <div>
          <h3 id={titleId} className="text-lg font-semibold text-white">
            确认保存配置覆盖
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            将与代码默认值不同的字段写入 D1 数据库。未修改的字段不会写入覆盖值，继续按代码默认值执行。
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono bg-slate-950 p-3 rounded-lg border border-slate-800">
          <span className="text-slate-400">目标模型:</span>
          <span className="text-white font-semibold">
            {model.name} ({model.id})
          </span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400">预期版本 (expectedVersion):</span>
          <span className="text-indigo-400 font-semibold">{model.version}</span>
        </div>

        {diff.hasChanges ? (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-slate-300">差异摘要 (Diff):</h4>
            <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden max-h-72 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
                    <th className="py-2.5 px-3 font-semibold">变更字段</th>
                    <th className="py-2.5 px-3 font-semibold">代码默认值</th>
                    <th className="py-2.5 px-3 font-semibold text-indigo-300">覆盖新值</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {diff.diffItems.map((item) => (
                    <tr key={item.field} className="hover:bg-slate-900/30">
                      <td className="py-2.5 px-3 font-medium text-white">{item.label}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-400 max-w-[200px] truncate">
                        {item.from}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-indigo-300 font-medium max-w-[240px] truncate">
                        {item.to}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-950 text-slate-400 text-xs text-center">
            当前配置与代码默认值完全一致，无需提交任何覆盖字段。
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            返回修改
          </button>
          <button
            type="button"
            disabled={submitting || !diff.hasChanges}
            onClick={onConfirm}
            className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50"
          >
            {submitting ? '保存中...' : `确认保存 (版本: ${model.version})`}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ClearConfirmModalProps {
  model: AdminModelConfigItem;
  submitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function ClearConfirmModal({ model, submitting, onClose, onConfirm }: ClearConfirmModalProps) {
  const titleId = useId();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <h3 id={titleId} className="text-lg font-semibold text-white">
          确认清除覆盖并恢复默认
        </h3>
        <p className="text-xs text-slate-300 leading-relaxed">
          您确定要清除模型「<span className="text-white font-medium">{model.name}</span>
          」的所有在线覆盖配置吗？
        </p>
        <p className="text-xs text-slate-400 leading-relaxed">
          清除后，新发起的生成任务将完全按代码中定义的默认参数与提示词执行。此操作会更新配置版本号。
        </p>

        <div className="text-xs font-mono bg-slate-950 p-2.5 rounded border border-slate-800 text-slate-400">
          目标模型: <span className="text-white">{model.id}</span> · 当前版本:{' '}
          <span className="text-indigo-400 font-semibold">{model.version}</span>
        </div>

        <div className="flex justify-end gap-3 pt-3">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onConfirm}
            className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors disabled:opacity-50"
          >
            {submitting ? '清除中...' : '确认清除，恢复默认'}
          </button>
        </div>
      </div>
    </div>
  );
}
