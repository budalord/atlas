import { useEffect, useState, useCallback } from "react";
import type { ApiEnvelope, FeaturePoint, ModuleSpec, RolesRegistry } from "../types";
import { FeedbackPool } from "./FeedbackPool";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { RolesEditor } from "./RolesEditor";

interface FeatureModalProps {
  productId: string;
  moduleId: string;
  featureId: string;
  onClose: () => void;
  /** 反馈池有变更时触发,让外部刷新 markmap 节点 ⚠ 状态 */
  onChanged?: () => void;
  readOnly?: boolean;
}

/**
 * 功能点弹窗:点 markmap 叶节点后从这里看描述 + 改反馈池。
 * 数据自己拉(GET /api/products/:id/features/:fid),onChanged 在父组件触发后由外部决定是否
 * 重新拉 markmap 数据。本组件内部 POST/DELETE 后会触发 onChanged 让父组件刷新树,
 * 同时本地 state 也重拉一次保证弹窗内即时刷新。
 */
export function FeatureModal({
  productId,
  moduleId,
  featureId,
  onClose,
  onChanged,
  readOnly = false
}: FeatureModalProps) {
  const [feature, setFeature] = useState<FeaturePoint | null>(null);
  const [moduleSpec, setModuleSpec] = useState<ModuleSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rolesRegistry, setRolesRegistry] = useState<RolesRegistry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}/features/${featureId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiEnvelope<{
        feature: FeaturePoint;
        module: ModuleSpec | null;
      }>;
      setFeature(json.data.feature);
      setModuleSpec(json.data.module);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [productId, featureId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/roles");
        if (!res.ok) return;
        const json = (await res.json()) as ApiEnvelope<RolesRegistry>;
        if (!cancelled) setRolesRegistry(json.data);
      } catch {
        // 注册表加载失败时,RolesEditor 内部会显示"加载中"占位,不阻塞 modal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRolesSaved = (updated: FeaturePoint) => {
    setFeature(updated);
    onChanged?.();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleFeedbackChanged = () => {
    void load();
    onChanged?.();
  };

  const target = `feature:${moduleId}:${featureId}`;
  const feedbackCount = feature?.feedback?.length ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-[70vw] max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
              {moduleSpec ? (
                <span className="rounded bg-slate-100 px-1.5 py-0.5">
                  {moduleSpec.title || moduleSpec.name}
                </span>
              ) : (
                <span className="rounded bg-slate-100 px-1.5 py-0.5">{moduleId}</span>
              )}
              {feature?.capability_id ? (
                <>
                  <span className="text-slate-300">›</span>
                  <span
                    className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800"
                    title={`Capability: ${feature.capability_id}`}
                  >
                    {feature.capability_id}
                  </span>
                </>
              ) : feature?.module_group ? (
                <>
                  <span className="text-slate-300">›</span>
                  <span
                    className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700"
                    title={`旧字段 module_group (v0.0): ${feature.module_group}, 应迁移到 capability_id`}
                  >
                    {feature.module_group}
                  </span>
                </>
              ) : (
                <span
                  className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700"
                  title="未归属任何 Capability — l0 警告"
                >
                  未归属
                </span>
              )}
              <span className="font-mono text-slate-400">{featureId}</span>
              {feature?.reviewed_at ? (
                <span
                  className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-emerald-800"
                  title={`审阅日期: ${feature.reviewed_at}${feature.reviewed_by ? " · " + feature.reviewed_by : ""}`}
                >
                  ✅ 已审
                </span>
              ) : null}
              {feature?.needs_revision ? (
                <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-800">
                  ⚠ 待 Agent 重做
                </span>
              ) : null}
            </div>
            <h2 className="text-xl font-semibold text-slate-900">
              {feature?.name ?? featureId}
            </h2>
          </div>
          <button
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
            type="button"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="py-10 text-center text-xs text-slate-500">加载中...</div>
          ) : error ? (
            <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : feature ? (
            <div className="space-y-4">
              {/* 给决策者(置顶 · 默认展开) — 决策者视角,白话 */}
              <section className="rounded-md border-2 border-emerald-300 bg-emerald-50/40">
                <header className="flex items-center justify-between border-b border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-900">
                  <span>给决策者</span>
                  <span className="text-[10px] font-normal text-emerald-700">决策者视角 · 业务决策方主要看这块</span>
                </header>
                <div className="px-4 py-3">
                  {feature.decision_maker_view.trim() ? (
                    <MarkdownRenderer markdown={feature.decision_maker_view} />
                  ) : (
                    <div className="rounded border border-dashed border-slate-300 bg-white px-3 py-2 text-[12px] italic text-slate-500">
                      该功能点尚未填写"给决策者"内容。展开下方"技术描述"看原始内容,或在反馈池投反馈让 Agent 补全。
                    </div>
                  )}
                </div>
              </section>

              {/* 技术描述(默认折叠) — 给 Agent / 工程师精确语境的原文 */}
              <details className="rounded-md border border-slate-200 bg-white">
                <summary className="cursor-pointer border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
                  技术描述 <span className="text-[11px] font-normal text-slate-400">(Agent / 工程师视角)</span>
                </summary>
                <div className="px-4 py-3">
                  {feature.description.trim() ? (
                    <MarkdownRenderer markdown={feature.description} />
                  ) : (
                    <div className="text-xs italic text-slate-400">(暂无描述)</div>
                  )}
                </div>
              </details>

              {/* 中形态: 关联实体 + 归属 */}
              {(feature.entities_touched && feature.entities_touched.length > 0) ||
              feature.ownership ? (
                <section className="rounded-md border border-slate-200 bg-white">
                  <header className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900">
                    关联实体 & 归属
                  </header>
                  <div className="space-y-2 px-4 py-3">
                    {feature.entities_touched && feature.entities_touched.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-slate-500">实体:</span>
                        {feature.entities_touched.map((e) => (
                          <span
                            key={e}
                            className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 font-mono text-[11px] text-indigo-800"
                          >
                            {e}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {feature.ownership ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-500">归属:</span>
                        <span
                          className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-800"
                          title="org=机构层 · campus=校区层 · follows:X=跟随 X · shared=跨产品"
                        >
                          {feature.ownership}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {/* 重形态: 字段清单 (可折叠) */}
              {feature.fields && feature.fields.length > 0 ? (
                <details className="rounded-md border border-slate-200 bg-white" open>
                  <summary className="cursor-pointer border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900">
                    字段清单 <span className="text-[11px] font-normal text-slate-500">({feature.fields.length})</span>
                  </summary>
                  <div className="overflow-auto px-4 py-3">
                    <table className="w-full text-[12px]">
                      <thead className="border-b border-slate-200 text-left text-slate-500">
                        <tr>
                          <th className="px-2 py-1 font-medium">字段</th>
                          <th className="px-2 py-1 font-medium">类型</th>
                          <th className="px-2 py-1 font-medium">必填</th>
                          <th className="px-2 py-1 font-medium">约束</th>
                          <th className="px-2 py-1 font-medium">备注</th>
                        </tr>
                      </thead>
                      <tbody>
                        {feature.fields.map((f, i) => (
                          <tr key={`${f.name}-${i}`} className="border-b border-slate-100 last:border-0">
                            <td className="px-2 py-1 font-mono text-slate-800">{f.name}</td>
                            <td className="px-2 py-1 font-mono text-slate-600">{f.type}</td>
                            <td className="px-2 py-1 text-center">
                              {f.required ? <span className="text-rose-600">✓</span> : <span className="text-slate-300">-</span>}
                            </td>
                            <td className="px-2 py-1 text-slate-600">{f.constraint || "—"}</td>
                            <td className="px-2 py-1 text-slate-500">{f.note || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : null}

              {/* 重形态: 状态转移 (可折叠) */}
              {feature.state_transitions && feature.state_transitions.length > 0 ? (
                <details className="rounded-md border border-slate-200 bg-white">
                  <summary className="cursor-pointer border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900">
                    状态转移 <span className="text-[11px] font-normal text-slate-500">({feature.state_transitions.length})</span>
                  </summary>
                  <div className="overflow-auto px-4 py-3">
                    <table className="w-full text-[12px]">
                      <thead className="border-b border-slate-200 text-left text-slate-500">
                        <tr>
                          <th className="px-2 py-1 font-medium">from</th>
                          <th className="px-2 py-1 font-medium">to</th>
                          <th className="px-2 py-1 font-medium">触发</th>
                          <th className="px-2 py-1 font-medium">角色</th>
                        </tr>
                      </thead>
                      <tbody>
                        {feature.state_transitions.map((t, i) => (
                          <tr key={i} className="border-b border-slate-100 last:border-0">
                            <td className="px-2 py-1 font-mono text-slate-700">{t.from}</td>
                            <td className="px-2 py-1 font-mono text-slate-700">→ {t.to}</td>
                            <td className="px-2 py-1 text-slate-600">{t.trigger}</td>
                            <td className="px-2 py-1 font-mono text-slate-500">{t.role}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : null}

              {/* 重形态: 字段权限 (可折叠) */}
              {feature.field_permissions && feature.field_permissions.length > 0 ? (
                <details className="rounded-md border border-slate-200 bg-white">
                  <summary className="cursor-pointer border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900">
                    字段权限 <span className="text-[11px] font-normal text-slate-500">({feature.field_permissions.length})</span>
                  </summary>
                  <div className="overflow-auto px-4 py-3">
                    <table className="w-full text-[12px]">
                      <thead className="border-b border-slate-200 text-left text-slate-500">
                        <tr>
                          <th className="px-2 py-1 font-medium">字段</th>
                          {Object.keys(feature.field_permissions[0]?.permissions ?? {}).map((roleId) => {
                            const name = rolesRegistry?.roles.find((r) => r.id === roleId)?.name ?? roleId;
                            return (
                              <th key={roleId} className="px-2 py-1 text-center font-medium">
                                {name}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {feature.field_permissions.map((row, i) => (
                          <tr key={`${row.field}-${i}`} className="border-b border-slate-100 last:border-0">
                            <td className="px-2 py-1 font-mono text-slate-800">{row.field}</td>
                            {Object.keys(feature.field_permissions?.[0]?.permissions ?? {}).map((roleId) => {
                              const perm = row.permissions[roleId];
                              const tone =
                                perm === "RW"
                                  ? "bg-emerald-50 text-emerald-800"
                                  : perm === "R"
                                    ? "bg-sky-50 text-sky-800"
                                    : "text-slate-300";
                              return (
                                <td
                                  key={roleId}
                                  className={`px-2 py-1 text-center text-[11px] font-mono ${tone}`}
                                >
                                  {perm ?? "-"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : null}

              <RolesEditor
                productId={productId}
                featureId={featureId}
                roles={feature.roles ?? []}
                registry={rolesRegistry}
                readOnly={readOnly}
                onSaved={handleRolesSaved}
              />

              <FeedbackPool
                feedback={feature.feedback ?? []}
                onChanged={handleFeedbackChanged}
                productId={productId}
                readOnly={readOnly}
                target={target}
              />

              {feedbackCount > 0 ? (
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  该功能点有 <span className="font-semibold">{feedbackCount}</span> 条反馈;
                  Agent 下轮 revise 时会读取这些反馈并在完成后清空反馈池 + 抹掉 frontmatter 的
                  needs_revision。
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
