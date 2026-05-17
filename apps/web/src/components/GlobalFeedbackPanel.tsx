import { useCallback, useEffect, useState } from "react";
import { useDataChange } from "../lib/useDataChange";
import type { ApiEnvelope, GlobalFeedback, GlobalFeedbackData, GlobalFeedbackScope } from "../types";

interface GlobalFeedbackPanelProps {
  productId: string;
  scope: GlobalFeedbackScope;
  /** 默认折叠;父组件可强制展开(比如点击 prompt 按钮时主动展开) */
  defaultOpen?: boolean;
}

const SCOPE_LABEL: Record<GlobalFeedbackScope, string> = {
  feature: "功能点",
  entity: "实体",
  prototype: "原型"
};

function generateClientId(today: string): string {
  const ymd = today.replace(/-/g, "");
  let rand = "";
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint8Array(4);
    crypto.getRandomValues(buf);
    rand = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 6);
  } else {
    rand = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  }
  return `gfb-${ymd}-${rand}`;
}

/**
 * 产品级"全局需求池"折叠面板 — 装"新增/删除 feature/entity/prototype"这类无法挂在
 * 已有对象上的反馈。三个 scope 共享一个 GLOBAL-FEEDBACK.md,在三段下分别存放,
 * 由 GlobalFeedbackPanel 通过 scope prop 切片显示。
 */
export function GlobalFeedbackPanel({
  productId,
  scope,
  defaultOpen = false
}: GlobalFeedbackPanelProps) {
  const [data, setData] = useState<GlobalFeedbackData | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productId}/global-feedback`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiEnvelope<GlobalFeedbackData>;
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [productId]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  useDataChange(() => {
    void load();
  });

  const items: GlobalFeedback[] = data ? data[scope] : [];
  const count = items.length;

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const id = generateClientId(new Date().toISOString().slice(0, 10));
      const res = await fetch(`/api/products/${productId}/global-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, content: trimmed, id })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setContent("");
      setCreating(false);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/products/${productId}/global-feedback/${id}`, {
        method: "DELETE"
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  };

  return (
    <section className="border-b border-slate-200 bg-amber-50/30">
      <header
        className="flex cursor-pointer items-center justify-between px-5 py-2 hover:bg-amber-50/60"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2 text-xs">
          <svg
            className={`h-3.5 w-3.5 text-slate-500 transition-transform ${open ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-medium text-slate-700">
            全局需求池 · {SCOPE_LABEL[scope]}
          </span>
          {count > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
              {count} 条待处理
            </span>
          ) : (
            <span className="text-[11px] text-slate-400">0 条</span>
          )}
        </div>
        {open ? (
          <button
            className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:border-amber-500"
            onClick={(e) => {
              e.stopPropagation();
              setCreating((v) => !v);
            }}
            type="button"
          >
            {creating ? "取消" : "+ 加需求"}
          </button>
        ) : null}
      </header>

      {open ? (
        <div className="px-5 pb-3">
          {error ? (
            <div className="mb-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
              {error}
            </div>
          ) : null}

          {creating ? (
            <form
              className="mb-2 rounded border border-amber-200 bg-white px-3 py-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSubmit();
              }}
            >
              <textarea
                autoFocus
                className="w-full resize-none rounded border border-slate-300 bg-white px-2 py-1 text-sm leading-5"
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder={`这条需求是关于「${SCOPE_LABEL[scope]}」的新增 / 删除 / 移动……⌘/Ctrl + Enter 提交`}
                rows={3}
                value={content}
              />
              <div className="mt-1 flex justify-end gap-2">
                <button
                  className="rounded px-2 py-0.5 text-[11px] text-slate-600 hover:text-slate-900"
                  onClick={() => {
                    setCreating(false);
                    setContent("");
                  }}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="rounded bg-amber-700 px-3 py-0.5 text-[11px] font-medium text-white hover:bg-amber-800 disabled:opacity-60"
                  disabled={submitting || content.trim().length === 0}
                  type="submit"
                >
                  {submitting ? "提交中..." : "+ 添加"}
                </button>
              </div>
            </form>
          ) : null}

          {items.length === 0 ? (
            <div className="py-2 text-[11px] text-slate-500">
              暂无{SCOPE_LABEL[scope]}级全局需求。这里装"新增 / 删除 / 移动"这类无法挂在已有对象上的反馈。
            </div>
          ) : (
            <ul className="divide-y divide-amber-100">
              {items.map((g) => (
                <li className="py-1.5" key={g.id}>
                  <div className="flex items-baseline justify-between gap-2 text-[11px]">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-slate-500">{g.date}</span>
                      <span className="font-mono text-[10px] text-slate-400" title={g.id}>
                        {g.id.slice(0, 12)}
                      </span>
                    </div>
                    <button
                      className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => handleDelete(g.id)}
                      title="删除该全局需求"
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap text-sm leading-5 text-slate-800">
                    {g.content}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
