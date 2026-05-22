import { useCallback, useEffect, useState } from "react";
import type { ApiEnvelope } from "../types";

/**
 * 通用 prompt 弹窗 — 同时承载两种模式:
 *   - mode="revise":  扫 needs_revision=true + 全局需求池,产出"修订增量" prompt
 *   - mode="generate":基于产品基础信息,产出"从零生成" prompt
 *
 * 两种模式的视觉一致(70vw×80vh + 深色预览 + 底部 4 按钮),
 * 只在标题文案和 endpoint 上区分。
 */

export type PromptScope =
  | "feature"
  | "entity"
  | "entity-derive"
  | "prototype"
  | "conventions"
  | "flowchart";

export type PromptMode = "revise" | "generate";

interface PromptModalDialogProps {
  productId: string;
  mode: PromptMode;
  scope: PromptScope;
  onClose: () => void;
}

interface PromptStats {
  features_with_revision?: number;
  entities_with_revision?: number;
  global_count?: number;
  has_description?: boolean;
  features_count?: number;
  entities_count?: number;
  conventions_exists?: boolean;
}

interface PromptData {
  prompt: string;
  stats: PromptStats;
}

const SCOPE_TITLE: Record<PromptScope, string> = {
  feature: "功能点",
  entity: "实体",
  "entity-derive": "Path C 派生实体",
  prototype: "原型",
  conventions: "L0 规范",
  flowchart: "流程图"
};

const MODE_TITLE: Record<PromptMode, string> = {
  revise: "复制全局 revise prompt",
  generate: "复制 Agent 提示词"
};

export function PromptModalDialog({
  productId,
  mode,
  scope,
  onClose
}: PromptModalDialogProps) {
  const [data, setData] = useState<PromptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const endpoint =
    mode === "revise"
      ? `/api/products/${productId}/revise-prompt?scope=${scope}`
      : `/api/products/${productId}/generate-prompt?scope=${scope}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiEnvelope<PromptData>;
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

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

  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const handleCopy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.prompt);
      setToast(`已复制 ${data.prompt.length} 个字符`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "剪贴板写入失败");
    }
  };

  const handleDownload = () => {
    if (!data) return;
    const blob = new Blob([data.prompt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${mode}-prompt-${productId}-${scope}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const stats = data?.stats;
  const statsLine = stats ? renderStats(mode, scope, stats) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-[70vw] max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold text-slate-900">
              📋 {MODE_TITLE[mode]} · {SCOPE_TITLE[scope]}
            </h2>
            {statsLine ? (
              <div className="text-[11px] text-slate-500">{statsLine}</div>
            ) : null}
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

        {toast ? (
          <div className="border-b border-emerald-200 bg-emerald-50 px-6 py-1.5 text-xs text-emerald-700">
            ✓ {toast}
          </div>
        ) : null}

        <div className="flex-1 overflow-hidden bg-slate-900 px-6 py-3">
          {loading ? (
            <div className="py-10 text-center text-xs text-slate-300">生成中...</div>
          ) : error ? (
            <div className="rounded border border-rose-700 bg-rose-950 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          ) : data ? (
            <pre className="h-full overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-5 text-slate-200">
              {data.prompt}
            </pre>
          ) : null}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-200 px-6 py-3">
          <button
            className="rounded px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900"
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
          <div className="flex items-center gap-2">
            <button
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-500 disabled:opacity-50"
              disabled={!data}
              onClick={handleDownload}
              type="button"
            >
              下载为 .txt
            </button>
            <button
              className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              disabled={!data}
              onClick={handleCopy}
              type="button"
            >
              复制到剪贴板
            </button>
            <button
              className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:border-emerald-500"
              onClick={() => void load()}
              type="button"
              title="重新拉取 — Agent 跑完后用这个看最新状态"
            >
              我已跑完,刷新
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function renderStats(mode: PromptMode, scope: PromptScope, stats: PromptStats): string {
  if (mode === "revise") {
    if (scope === "prototype") return `全局需求条目: ${stats.global_count ?? 0} 条`;
    const reviseCount =
      scope === "feature"
        ? stats.features_with_revision ?? 0
        : stats.entities_with_revision ?? 0;
    return `需要修订: ${reviseCount} 个  ·  全局需求: ${stats.global_count ?? 0} 条`;
  }
  const parts: string[] = [];
  if (stats.has_description !== undefined) {
    parts.push(stats.has_description ? "已有产品描述" : "缺少产品描述");
  }
  if (stats.features_count !== undefined) parts.push(`已有 features: ${stats.features_count}`);
  if (stats.entities_count !== undefined) parts.push(`已有 entities: ${stats.entities_count}`);
  if (scope === "conventions" && stats.conventions_exists !== undefined) {
    parts.push(stats.conventions_exists ? "L0 已存在(请增量更新)" : "L0 尚未生成");
  }
  return parts.join("  ·  ");
}
