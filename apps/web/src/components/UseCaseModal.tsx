import { useCallback, useEffect, useState } from "react";
import type { ApiEnvelope, Feedback, UseCase } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { PromptModalDialog } from "./PromptModalDialog";

interface UseCaseModalProps {
  productId: string;
  functionId: string;
  usecaseId: string;
  module: string;
  onClose: () => void;
}

/**
 * UseCase 弹窗 — 点 markmap usecase 叶节点弹此。
 *
 * v0.2a 升级:
 *   - 展示 ## 反馈池(parser 已聚合到 UseCase.feedback)
 *   - 「记反馈」按钮 → POST /api/products/:id/feedback target=usecase:<m>:<fn>:<u>
 *   - 「复制 revise prompt」按钮 → PromptModalDialog scope=usecase
 *   - frontmatter.split_suggestion 顶部黄色 banner + 「已处理」按钮(PATCH split_suggestion=null)
 */
export function UseCaseModal({
  productId,
  functionId,
  usecaseId,
  module,
  onClose
}: UseCaseModalProps) {
  const [uc, setUc] = useState<UseCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedbackInput, setFeedbackInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}/usecases/${functionId}/${usecaseId}`);
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(`usecase 不存在: ${functionId}/${usecaseId}`);
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as ApiEnvelope<UseCase>;
      setUc(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [productId, functionId, usecaseId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const target = `usecase:${module}:${functionId}:${usecaseId}`;

  const submitFeedback = async () => {
    const content = feedbackInput.trim();
    if (!content) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, content })
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setFeedbackInput("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交反馈失败");
    } finally {
      setBusy(false);
    }
  };

  const deleteFb = async (fb: Feedback) => {
    if (!window.confirm(`删除反馈 ${fb.id}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}/feedback/${fb.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target })
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除反馈失败");
    } finally {
      setBusy(false);
    }
  };

  const clearSplitSuggestion = async () => {
    if (!window.confirm("清除 split_suggestion?(确认你已对该 usecase 做了拆分决策)")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/products/${productId}/usecases/${functionId}/${usecaseId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ split_suggestion: null })
        }
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "清除失败");
    } finally {
      setBusy(false);
    }
  };

  const feedbackList = uc?.feedback ?? [];
  const needsRevision = uc?.needs_revision ?? false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] w-[72vw] max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700">
                UseCase
              </span>
              <span>module: {module}</span>
              <span className="text-slate-300">›</span>
              <span>function: {functionId}</span>
              {needsRevision ? (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                  needs_revision
                </span>
              ) : null}
            </div>
            <h2 className="text-xl font-semibold text-slate-900">{uc?.id ?? usecaseId}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-slate-500"
              onClick={() => setPromptOpen(true)}
              type="button"
              title="复制本产品全部 needs_revision usecase 的 revise prompt"
            >
              复制 revise prompt
            </button>
            <button
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              onClick={onClose}
              type="button"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="py-10 text-center text-xs text-slate-500">加载中...</div>
          ) : error ? (
            <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : uc ? (
            <div className="space-y-4">
              {/* split_suggestion banner */}
              {uc.split_suggestion ? (
                <section className="rounded-md border-2 border-amber-300 bg-amber-50 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold text-amber-900">
                        ⚠️ Agent 拆分建议
                      </div>
                      <div className="mt-1 text-[13px] text-amber-900">
                        {uc.split_suggestion}
                      </div>
                    </div>
                    <button
                      className="shrink-0 rounded border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:border-amber-600 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void clearSplitSuggestion()}
                      type="button"
                    >
                      已处理,清除
                    </button>
                  </div>
                </section>
              ) : null}

              {/* meta */}
              <section className="rounded-md border border-emerald-200 bg-emerald-50/40 px-4 py-3">
                <div className="text-[10px] font-medium text-emerald-800">UseCase 元信息</div>
                <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-2">
                  <Meta label="主参与者 (actor)" value={uc.actor_id} mono />
                  <Meta
                    label="操作实体"
                    value={
                      uc.entity_ids && uc.entity_ids.length > 0
                        ? uc.entity_ids.join(" · ")
                        : "(继承自 function)"
                    }
                  />
                  {uc.precondition ? <Meta label="前置条件" value={uc.precondition} fullWidth /> : null}
                  {uc.postcondition ? (
                    <Meta label="后置条件" value={uc.postcondition} fullWidth />
                  ) : null}
                </dl>
              </section>

              {/* 主流程 / 备选流程 / 备注 / 反馈池 / 修订记录 — body 原样渲染 */}
              <section className="rounded-md border border-slate-200 bg-white px-4 py-3">
                <MarkdownRenderer markdown={uc.body} />
              </section>

              {/* 反馈池操作面 */}
              <section className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold text-slate-700">
                    反馈池({feedbackList.length} 条)
                  </div>
                </div>
                {feedbackList.length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {feedbackList.map((fb) => (
                      <li
                        key={fb.id}
                        className="flex items-start justify-between gap-3 rounded border border-slate-200 bg-white px-3 py-2 text-[12px]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-[10px] text-slate-500">
                            <span className="font-mono">{fb.id}</span>
                            <span>·</span>
                            <span>{fb.date}</span>
                          </div>
                          <div className="mt-0.5 whitespace-pre-wrap text-slate-800">
                            {fb.content}
                          </div>
                        </div>
                        <button
                          className="shrink-0 text-[11px] text-rose-600 hover:text-rose-800 disabled:opacity-50"
                          disabled={busy}
                          onClick={() => void deleteFb(fb)}
                          type="button"
                        >
                          删除
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-3 flex items-start gap-2">
                  <textarea
                    className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-[12px] focus:border-slate-500 focus:outline-none"
                    placeholder="记一条业务反馈(下次 agent revise 时会处理)"
                    rows={2}
                    value={feedbackInput}
                    onChange={(e) => setFeedbackInput(e.target.value)}
                  />
                  <button
                    className="shrink-0 rounded bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    disabled={busy || feedbackInput.trim().length === 0}
                    onClick={() => void submitFeedback()}
                    type="button"
                  >
                    记反馈
                  </button>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </div>

      {promptOpen ? (
        <PromptModalDialog
          productId={productId}
          mode="revise"
          scope="usecase"
          onClose={() => setPromptOpen(false)}
        />
      ) : null}
    </div>
  );
}

function Meta({
  label,
  value,
  mono,
  fullWidth
}: {
  label: string;
  value: string;
  mono?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? "sm:col-span-2" : ""}>
      <dt className="text-[10px] text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-slate-900 ${mono ? "font-mono text-[11px]" : ""}`}>{value}</dd>
    </div>
  );
}
