import { useCallback, useEffect, useState } from "react";
import type { ApiEnvelope } from "../../types";
import { useDataChange } from "../../lib/useDataChange";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { PromptModalDialog, type PromptMode } from "../PromptModalDialog";

interface ConventionsTabProps {
  productId: string;
  readOnly?: boolean;
}

interface ConventionsData {
  exists: boolean;
  content?: string;
  last_updated?: string | null;
}

/**
 * L0 规范 tab — 展示 data/products/<id>/CONVENTIONS.md。
 *
 *   - 文件存在: markdown 渲染 + 顶部右上 "生成/更新 L0 规范" 按钮
 *   - 文件不存在: 空态 + 居中的大号"生成 L0 规范"按钮
 *
 * 本批次只提供 generate(从零生成 + 增量重跑),不提供 revise(L0 是全集快照,
 * 有变化让 Agent 重跑一次比逐条修订更自然)。
 */
export function ConventionsTab({ productId, readOnly = false }: ConventionsTabProps) {
  const [data, setData] = useState<ConventionsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState<PromptMode | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productId}/conventions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiEnvelope<ConventionsData>;
      setData(json.data);
      setError(null);
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

  if (error) return <div className="p-5 text-sm text-rose-700">{error}</div>;
  if (data === null) return <div className="p-5 text-xs text-slate-500">加载中...</div>;

  if (!data.exists) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <div className="text-sm text-slate-600">L0 规范尚未生成</div>
        <div className="max-w-md text-center text-xs leading-5 text-slate-500">
          L0 规范装产品级硬约束(命名/字段/通用流程/一致性/禁忌/决策快照六段),
          Agent 在 L1(实体)/ L2(功能点)操作时必须遵循。
          <br />
          点击下方按钮生成提示词,把它丢给 Claude Code 让规范 Agent 写 CONVENTIONS.md。
        </div>
        {!readOnly ? (
          <button
            className="rounded-lg border-2 border-slate-900 bg-white px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-900 hover:text-white"
            onClick={() => setPromptOpen("generate")}
            type="button"
          >
            📋 生成 L0 规范
          </button>
        ) : null}
        {promptOpen ? (
          <PromptModalDialog
            mode={promptOpen}
            onClose={() => setPromptOpen(null)}
            productId={productId}
            scope="conventions"
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-2">
        <div className="text-[11px] text-slate-500">
          <span className="font-medium text-slate-700">CONVENTIONS.md</span>
          {data.last_updated ? (
            <span className="ml-2 font-mono">last_updated: {data.last_updated}</span>
          ) : null}
        </div>
        {!readOnly ? (
          <button
            className="rounded border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 hover:border-slate-900 hover:text-slate-900"
            onClick={() => setPromptOpen("generate")}
            title="生成/更新 L0 规范 prompt(给规范 Agent)"
            type="button"
          >
            📋 规范 Agent · 生成/更新 L0 规范
          </button>
        ) : null}
      </div>
      <div className="overflow-auto px-6 py-4">
        <MarkdownRenderer markdown={data.content ?? ""} />
      </div>
      {promptOpen ? (
        <PromptModalDialog
          mode={promptOpen}
          onClose={() => setPromptOpen(null)}
          productId={productId}
          scope="conventions"
        />
      ) : null}
    </div>
  );
}
