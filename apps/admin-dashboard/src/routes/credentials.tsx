import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useId, useState } from 'react';
import {
  type AdminCredentialItem,
  archiveCredentialRpc,
  createCredentialRpc,
  getAdminCredentials,
  setDefaultCredentialRpc,
  updateCredentialRpc,
} from '~/lib/site-rpc';
import { MANAGED_SITES, resolveSiteId } from '~/lib/sites';

interface SearchParams {
  siteId?: string;
}

export const Route = createFileRoute('/credentials')({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    siteId: resolveSiteId(search.siteId),
  }),
  loaderDeps: ({ search }) => ({
    siteId: search.siteId,
  }),
  loader: async ({
    deps,
  }): Promise<{
    credentials: AdminCredentialItem[];
    activeSite: (typeof MANAGED_SITES)[number] | null;
    error: string | null;
  }> => {
    const activeSite = MANAGED_SITES.find((s) => s.id === deps.siteId) || MANAGED_SITES[0];
    if (!activeSite) return { credentials: [], activeSite: null, error: '未找到配置的站点' };

    try {
      const credentials = await getAdminCredentials({
        data: { siteId: activeSite.id },
      });
      return { credentials, activeSite, error: null };
    } catch (err: unknown) {
      return {
        credentials: [],
        activeSite,
        error: err instanceof Error ? err.message : '获取上游凭据失败',
      };
    }
  },
  component: CredentialsPage,
});

function parseRpcError(err: unknown): {
  isConflict: boolean;
  isCredentialInUse: boolean;
  message: string;
} {
  const errText = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;
  const isConflict = status === 409 || /\b409\b/.test(errText);
  const isCredentialInUse = /credential_in_use/i.test(errText);

  if (isConflict) {
    if (isCredentialInUse) {
      return { isConflict: true, isCredentialInUse: true, message: '仍被模型或默认设置引用' };
    }
    return { isConflict: true, isCredentialInUse: false, message: '配置已被修改，请刷新' };
  }
  const match = errText.match(/RPC failed with status \d+:\s*(.+)$/s);
  const serverReason = match ? match[1].trim() : errText;
  return { isConflict: false, isCredentialInUse: false, message: serverReason };
}

function CredentialsPage() {
  const { credentials, activeSite, error } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();

  const [showArchived, setShowArchived] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCred, setEditingCred] = useState<AdminCredentialItem | null>(null);
  const [archivingCred, setArchivingCred] = useState<AdminCredentialItem | null>(null);
  const [actionError, setActionError] = useState<{ isConflict: boolean; message: string } | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const displayedCredentials = showArchived ? credentials : credentials.filter((c) => !c.archivedAt);

  const handleSetDefault = async (cred: AdminCredentialItem, shouldBeDefault: boolean) => {
    if (submitting || !activeSite) return;
    setSubmitting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await setDefaultCredentialRpc({
        data: {
          siteId: activeSite.id,
          upstream: cred.upstream,
          id: shouldBeDefault ? cred.id : null,
        },
      });
      setActionSuccess(
        shouldBeDefault
          ? `已将「${cred.name}」设为 ${cred.upstream} 的默认凭据`
          : `已取消「${cred.name}」的默认凭据标记`,
      );
      await router.invalidate();
    } catch (err: unknown) {
      const parsed = parseRpcError(err);
      setActionError(parsed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* 头部标题与站点切换 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">上游凭据</h1>
          <p className="text-sm text-slate-400 mt-1">
            管理各上游服务商（如 Yir）的 API Key 与访问端点，由站点 D1 加密存储，可按模型独立绑定
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="cred-site-select" className="text-xs text-slate-400">
              选择站点:
            </label>
            <select
              id="cred-site-select"
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

          <button
            type="button"
            onClick={() => {
              setActionError(null);
              setActionSuccess(null);
              setShowCreateModal(true);
            }}
            className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-lg shadow-indigo-600/30 flex items-center gap-1.5"
          >
            <span>+</span>
            <span>新建凭据</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 text-sm">
          {error}
        </div>
      )}

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
                router.invalidate();
              }}
              className="px-3 py-1.5 text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 rounded-lg transition-colors whitespace-nowrap self-start sm:self-auto"
            >
              刷新
            </button>
          )}
        </div>
      )}

      {/* 筛选工具栏 */}
      <div className="flex items-center justify-between px-1 text-xs text-slate-400">
        <div>
          共 <span className="text-white font-mono">{credentials.length}</span> 条凭据
          {showArchived && (
            <span>
              （含{' '}
              <span className="text-amber-400 font-mono">
                {credentials.filter((c) => c.archivedAt).length}
              </span>{' '}
              条已归档）
            </span>
          )}
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 focus:ring-offset-0"
          />
          <span>显示已归档凭据</span>
        </label>
      </div>

      {/* 凭据表格 */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">名称 / ID</th>
                <th className="py-3 px-4">上游 (Upstream)</th>
                <th className="py-3 px-4">服务端点 (Base URL)</th>
                <th className="py-3 px-4">Key 末 4 位</th>
                <th className="py-3 px-4">默认标记</th>
                <th className="py-3 px-4">引用模型数</th>
                <th className="py-3 px-4">在途任务</th>
                <th className="py-3 px-4">状态</th>
                <th className="py-3 px-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {displayedCredentials.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500">
                    {credentials.length === 0 ? '暂无上游凭据配置，点击右上角新建' : '无符合筛选条件的凭据'}
                  </td>
                </tr>
              ) : (
                displayedCredentials.map((c) => {
                  const isArchived = c.archivedAt !== null;
                  return (
                    <tr
                      key={c.id}
                      className={`hover:bg-slate-850/30 transition-colors ${
                        isArchived ? 'opacity-60 bg-slate-950/40' : ''
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="font-medium text-white">{c.name}</div>
                        <div className="text-xs font-mono text-slate-500 mt-0.5">{c.id}</div>
                      </td>

                      <td className="py-3 px-4 font-mono">
                        <span className="px-2 py-0.5 rounded text-xs bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                          {c.upstream}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-xs font-mono max-w-[200px] truncate">
                        {c.baseUrl ? (
                          <span className="text-slate-200" title={c.baseUrl}>
                            {c.baseUrl}
                          </span>
                        ) : (
                          <span className="text-slate-500">默认地址</span>
                        )}
                      </td>

                      <td className="py-3 px-4 font-mono text-xs text-indigo-300">••••{c.keyHint}</td>

                      <td className="py-3 px-4">
                        {c.isDefault ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            ★ 默认
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600">-</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-xs font-mono">
                        {c.modelCount > 0 ? (
                          <span className="text-slate-200">{c.modelCount} 个模型</span>
                        ) : (
                          <span className="text-slate-500">0</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-xs font-mono">
                        {c.activeJobCount > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-amber-500/10 text-amber-300 border border-amber-500/20 font-medium">
                            ⚡ {c.activeJobCount}
                          </span>
                        ) : (
                          <span className="text-slate-500">0</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-xs font-mono">
                        {isArchived ? (
                          <span className="px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-400 border border-slate-700">
                            已归档
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            ● 正常
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {!isArchived && (
                            <>
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => {
                                  setActionError(null);
                                  setActionSuccess(null);
                                  setEditingCred(c);
                                }}
                                className="px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 transition-colors"
                              >
                                编辑
                              </button>

                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => handleSetDefault(c, !c.isDefault)}
                                className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                                  c.isDefault
                                    ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                                    : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                }`}
                              >
                                {c.isDefault ? '取消默认' : '设为默认'}
                              </button>

                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => {
                                  setActionError(null);
                                  setActionSuccess(null);
                                  setArchivingCred(c);
                                }}
                                className="px-2.5 py-1 text-xs font-medium bg-rose-600/10 hover:bg-rose-600/20 text-rose-300 border border-rose-500/30 rounded transition-colors"
                              >
                                归档
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新建凭据弹窗 */}
      {showCreateModal && activeSite && (
        <CreateCredentialModal
          siteId={activeSite.id}
          onClose={() => setShowCreateModal(false)}
          onSuccess={async (name) => {
            setShowCreateModal(false);
            setActionSuccess(`凭据「${name}」创建成功！`);
            await router.invalidate();
          }}
        />
      )}

      {/* 编辑凭据弹窗 */}
      {editingCred && activeSite && (
        <EditCredentialModal
          siteId={activeSite.id}
          credential={editingCred}
          onClose={() => setEditingCred(null)}
          onSuccess={async (name, version) => {
            setEditingCred(null);
            setActionSuccess(`凭据「${name}」已更新 (版本: v${version})！`);
            await router.invalidate();
          }}
        />
      )}

      {/* 归档二次确认弹窗 */}
      {archivingCred && activeSite && (
        <ArchiveConfirmModal
          siteId={activeSite.id}
          credential={archivingCred}
          onClose={() => setArchivingCred(null)}
          onSuccess={async (name, version) => {
            setArchivingCred(null);
            setActionSuccess(`凭据「${name}」已成功归档 (版本: v${version})！`);
            await router.invalidate();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------
// 新建凭据模态框
// ---------------------------------------------------------
interface CreateModalProps {
  siteId: string;
  onClose: () => void;
  onSuccess: (name: string) => Promise<void>;
}

function CreateCredentialModal({ siteId, onClose, onSuccess }: CreateModalProps) {
  const titleId = useId();
  const [name, setName] = useState('');
  const [upstream, setUpstream] = useState('yir');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 100) {
      setErrorMsg('凭据名称必须在 1 到 100 个字符之间');
      return;
    }

    const trimmedKey = apiKey.trim();
    if (!trimmedKey || trimmedKey.length > 1024) {
      setErrorMsg('API Key 必须填写且不超过 1024 个字符');
      return;
    }

    const trimmedUrl = baseUrl.trim();
    if (trimmedUrl) {
      if (!trimmedUrl.startsWith('https://')) {
        setErrorMsg('服务端点地址必须以 https:// 开头');
        return;
      }
      try {
        new URL(trimmedUrl);
      } catch {
        setErrorMsg('请输入合法的 URL 地址');
        return;
      }
    }

    setSubmitting(true);
    // 敏感 Key 用后立即清空内存
    const payloadKey = trimmedKey;
    setApiKey('');

    try {
      await createCredentialRpc({
        data: {
          siteId,
          name: trimmedName,
          upstream: upstream.trim(),
          baseUrl: trimmedUrl || null,
          apiKey: payloadKey,
        },
      });
      await onSuccess(trimmedName);
    } catch (err: unknown) {
      const parsed = parseRpcError(err);
      setErrorMsg(parsed.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 my-8">
        <div>
          <h3 id={titleId} className="text-lg font-semibold text-white">
            新建上游凭据
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            API Key 将通过 Worker 秘钥加密写入站点 D1，绝不保存在浏览器中
          </p>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="create-cred-name" className="block text-xs font-medium text-slate-300 mb-1">
              凭据名称 <span className="text-rose-400">*</span>
            </label>
            <input
              id="create-cred-name"
              type="text"
              required
              maxLength={100}
              value={name}
              disabled={submitting}
              onChange={(e) => setName(e.target.value)}
              placeholder="如 生产主账号 (Yir)"
              className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 font-sans"
            />
          </div>

          <div>
            <label htmlFor="create-cred-upstream" className="block text-xs font-medium text-slate-300 mb-1">
              上游服务商 (Upstream) <span className="text-rose-400">*</span>
            </label>
            <input
              id="create-cred-upstream"
              type="text"
              required
              value={upstream}
              disabled={submitting}
              onChange={(e) => setUpstream(e.target.value)}
              placeholder="yir"
              className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>

          <div>
            <label htmlFor="create-cred-baseurl" className="block text-xs font-medium text-slate-300 mb-1">
              服务端点地址 (Base URL)
            </label>
            <input
              id="create-cred-baseurl"
              type="url"
              value={baseUrl}
              disabled={submitting}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.yir.ai (留空使用适配器默认地址)"
              className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 font-mono"
            />
            <div className="mt-1 text-[11px] text-slate-500">
              可选，自定义端点或私有网关必须为 https:// 协议
            </div>
          </div>

          <div>
            <label htmlFor="create-cred-apikey" className="block text-xs font-medium text-slate-300 mb-1">
              API Key <span className="text-rose-400">*</span>
            </label>
            <input
              id="create-cred-apikey"
              type="password"
              required
              autoComplete="new-password"
              maxLength={1024}
              value={apiKey}
              disabled={submitting}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 font-mono"
            />
            <div className="mt-1 text-[11px] text-slate-500">
              明文 Key 仅在提交瞬间于内存传输加密，提交后立即清除，绝不缓存在本地
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setApiKey('');
                onClose();
              }}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-lg shadow-indigo-600/30 disabled:opacity-50"
            >
              {submitting ? '提交中...' : '确认创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// 编辑凭据模态框 (含在途任务二次确认)
// ---------------------------------------------------------
interface EditModalProps {
  siteId: string;
  credential: AdminCredentialItem;
  onClose: () => void;
  onSuccess: (name: string, version: number) => Promise<void>;
}

function EditCredentialModal({ siteId, credential, onClose, onSuccess }: EditModalProps) {
  const titleId = useId();
  const [name, setName] = useState(credential.name);
  const [baseUrl, setBaseUrl] = useState(credential.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showActiveJobsWarning, setShowActiveJobsWarning] = useState(false);

  const performUpdate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 100) {
      setErrorMsg('凭据名称必须在 1 到 100 个字符之间');
      return;
    }

    const trimmedUrl = baseUrl.trim();
    if (trimmedUrl) {
      if (!trimmedUrl.startsWith('https://')) {
        setErrorMsg('服务端点地址必须以 https:// 开头');
        return;
      }
      try {
        new URL(trimmedUrl);
      } catch {
        setErrorMsg('请输入合法的 URL 地址');
        return;
      }
    }

    const trimmedKey = apiKey.trim();
    setSubmitting(true);
    // 敏感 Key 拷贝后立即清空内存状态
    const keyToSend = trimmedKey || undefined;
    setApiKey('');

    try {
      const res = await updateCredentialRpc({
        data: {
          siteId,
          id: credential.id,
          expectedVersion: credential.version,
          name: trimmedName,
          baseUrl: trimmedUrl ? trimmedUrl : null,
          apiKey: keyToSend,
        },
      });
      await onSuccess(trimmedName, res.version);
    } catch (err: unknown) {
      const parsed = parseRpcError(err);
      setErrorMsg(parsed.message);
      setShowActiveJobsWarning(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePreSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // 校验 baseUrl
    const trimmedUrl = baseUrl.trim();
    if (trimmedUrl) {
      if (!trimmedUrl.startsWith('https://')) {
        setErrorMsg('服务端点地址必须以 https:// 开头');
        return;
      }
      try {
        new URL(trimmedUrl);
      } catch {
        setErrorMsg('请输入合法的 URL 地址');
        return;
      }
    }

    // 若有进行中任务，弹窗提示
    if (credential.activeJobCount > 0) {
      setShowActiveJobsWarning(true);
    } else {
      performUpdate();
    }
  };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto"
      >
        <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 my-8">
          <div>
            <h3 id={titleId} className="text-lg font-semibold text-white">
              编辑上游凭据
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              更新凭据名称、端点地址或 API Key (当前版本: v{credential.version})
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handlePreSubmit} className="space-y-4">
            <div>
              <label htmlFor="edit-cred-name" className="block text-xs font-medium text-slate-300 mb-1">
                凭据名称 <span className="text-rose-400">*</span>
              </label>
              <input
                id="edit-cred-name"
                type="text"
                required
                maxLength={100}
                value={name}
                disabled={submitting}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 font-sans"
              />
            </div>

            <div>
              <label htmlFor="edit-cred-upstream" className="block text-xs font-medium text-slate-300 mb-1">
                上游服务商 (Upstream)
              </label>
              <input
                id="edit-cred-upstream"
                type="text"
                readOnly
                disabled
                value={credential.upstream}
                className="w-full bg-slate-950/60 border border-slate-800 text-sm text-slate-400 rounded-lg px-3 py-2 font-mono cursor-not-allowed"
              />
            </div>

            <div>
              <label htmlFor="edit-cred-baseurl" className="block text-xs font-medium text-slate-300 mb-1">
                服务端点地址 (Base URL)
              </label>
              <input
                id="edit-cred-baseurl"
                type="url"
                value={baseUrl}
                disabled={submitting}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.yir.ai (留空或清空表示恢复官方默认地址)"
                className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <div className="mt-1 text-[11px] text-slate-500">
                留空表示使用适配器官方默认地址；修改时必须以 https:// 开头
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="edit-cred-apikey" className="text-xs font-medium text-slate-300">
                  新 API Key (留空表示不修改)
                </label>
                <span className="text-[11px] font-mono text-indigo-400">
                  当前 Key 末 4 位: ••••{credential.keyHint}
                </span>
              </div>
              <input
                id="edit-cred-apikey"
                type="password"
                autoComplete="new-password"
                maxLength={1024}
                value={apiKey}
                disabled={submitting}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="留空表示不修改已有 Key"
                className="w-full bg-slate-950 border border-slate-700 text-sm text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <div className="mt-1 text-[11px] text-slate-500">
                编辑时 Key 留空表示不修改已有秘钥；若输入新秘钥，将在提交后立即清空内存且不存本地
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setApiKey('');
                  onClose();
                }}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-lg shadow-indigo-600/30 disabled:opacity-50"
              >
                {submitting ? '保存中...' : '保存修改'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* 进行中任务影响提示二次确认弹窗 */}
      {showActiveJobsWarning && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-60"
        >
          <div className="bg-slate-900 border border-amber-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h4 className="text-base font-semibold text-amber-300 flex items-center gap-2">
              <span>⚠️</span>
              <span>有正在执行中的任务</span>
            </h4>
            <p className="text-xs text-slate-200 leading-relaxed">
              有 <span className="font-bold text-amber-400 font-mono">{credential.activeJobCount}</span>{' '}
              个进行中的任务正在使用这条凭据，修改后它们的后续请求会使用新值，若换了账号可能失败。
            </p>
            <p className="text-xs text-slate-400 leading-relaxed">您确定要立即保存该修改吗？</p>
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowActiveJobsWarning(false)}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
              >
                取消修改
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={performUpdate}
                className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 rounded-lg transition-colors shadow-lg shadow-amber-600/30 disabled:opacity-50"
              >
                {submitting ? '提交中...' : '确认继续修改'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------
// 归档二次确认模态框
// ---------------------------------------------------------
interface ArchiveModalProps {
  siteId: string;
  credential: AdminCredentialItem;
  onClose: () => void;
  onSuccess: (name: string, version: number) => Promise<void>;
}

function ArchiveConfirmModal({ siteId, credential, onClose, onSuccess }: ArchiveModalProps) {
  const titleId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleArchive = async () => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await archiveCredentialRpc({
        data: {
          siteId,
          id: credential.id,
          expectedVersion: credential.version,
        },
      });
      await onSuccess(credential.name, res.version);
    } catch (err: unknown) {
      const parsed = parseRpcError(err);
      setErrorMsg(parsed.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <h3 id={titleId} className="text-lg font-semibold text-white">
          确认归档凭据
        </h3>
        <p className="text-xs text-slate-300 leading-relaxed">
          您确定要归档凭据「<span className="text-white font-medium">{credential.name}</span>」吗？
        </p>
        <p className="text-xs text-slate-400 leading-relaxed">
          归档后该凭据不可再作为默认凭据或绑定新任务。已引用它的进行中任务仍可解密继续执行。
        </p>

        {credential.modelCount > 0 && (
          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs">
            ⚠️ 当前有 {credential.modelCount}{' '}
            个模型配置直接引用此凭据。若仍被模型或默认设置引用，将被拒绝归档。
          </div>
        )}

        {errorMsg && (
          <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs font-medium">
            {errorMsg}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
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
            onClick={handleArchive}
            className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors disabled:opacity-50"
          >
            {submitting ? '归档中...' : '确认归档'}
          </button>
        </div>
      </div>
    </div>
  );
}
