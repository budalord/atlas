import { useCallback, useEffect, useState } from "react";
import type { ApiEnvelope, L0ViolationsData } from "../../types";
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
      <div className="flex flex-col gap-6 p-6">
        <div className="flex h-[40vh] flex-col items-center justify-center gap-4">
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
              生成 L0 规范
            </button>
          ) : null}
        </div>
        {/* L0 违规检测不依赖 CONVENTIONS.md(检 frontmatter / 命名 / 引用 等机械规则) */}
        <L0ViolationsPanel productId={productId} />
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
            生成/更新 L0 规范
          </button>
        ) : null}
      </div>
      <div className="overflow-auto px-6 py-4">
        <MarkdownRenderer markdown={data.content ?? ""} />
        <L0ViolationsPanel productId={productId} />
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

/**
 * L0 违规面板:每次进入 CONVENTIONS tab 实时跑机械化 lint(features vs 命名约定 /
 * RolesRegistry 引用 / module_group 引用 / ownership enum 等)。
 */
function L0ViolationsPanel({ productId }: { productId: string }) {
  const [data, setData] = useState<L0ViolationsData | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productId}/l0-violations`);
      if (!res.ok) return;
      const json = (await res.json()) as ApiEnvelope<L0ViolationsData>;
      setData(json.data);
    } catch {
      /* silent */
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  useDataChange(() => {
    void load();
  });

  if (data === null) return null;

  const errorCount = data.violations.filter((v) => v.severity === "error").length;
  const warnCount = data.violations.filter((v) => v.severity === "warn").length;
  const headerCls = errorCount > 0
    ? "border-rose-200 bg-rose-50 text-rose-800"
    : warnCount > 0
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-emerald-200 bg-emerald-50 text-emerald-800";

  return (
    <div className={`mt-6 rounded-md border ${headerCls}`}>
      <div className="border-b border-current/20 px-4 py-2 text-sm font-semibold">
        L0 违规检测(机械化)
        <span className="ml-2 text-[11px] font-normal opacity-80">
          {data.total === 0
            ? "全部通过"
            : `${data.total} 项 · error ${errorCount} / warn ${warnCount}`}
        </span>
        <span className="ml-2 text-[10px] font-normal opacity-60">
          生成于 {data.generated_at ? formatGenTime(data.generated_at) : "—"}
        </span>
      </div>
      {data.violations.length > 0 ? (
        <ul className="divide-y divide-current/10 text-[12px]">
          {data.violations.map((v, i) => (
            <li className="px-4 py-2" key={i}>
              <div className="flex items-baseline gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  v.severity === "error"
                    ? "bg-rose-200 text-rose-900"
                    : "bg-amber-200 text-amber-900"
                }`}>
                  {v.severity}
                </span>
                <span className="font-mono text-[10px] opacity-60">{v.category}</span>
                <span className="flex-1 text-slate-900">{v.message}</span>
              </div>
              <div className="mt-1 ml-1 text-[10px] font-mono opacity-70">{v.source}</div>
              {v.suggestion ? (
                <div className="mt-0.5 ml-1 text-[11px] italic opacity-80">建议:{v.suggestion}</div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-4 py-3 text-[12px] italic opacity-80">
          ✓ 没有发现机械化可检的 L0 违规。语义级违规(描述写作风格 / 禁忌段) 需派生 Agent prompt 检查(后续轮次)。
        </div>
      )}
    </div>
  );
}

function formatGenTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 16).replace("T", " ");
  } catch {
    return iso;
  }
}
