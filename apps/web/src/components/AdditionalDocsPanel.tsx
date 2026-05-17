import { useEffect, useState } from "react";
import { useDataChange } from "../lib/useDataChange";
import type { ApiEnvelope } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ExtraDoc {
  name: string;
  sizeBytes: number;
  content: string;
}

interface AdditionalDocsPanelProps {
  productId: string;
  /** 立项阶段默认展开权威源(用户在这阶段最常需要查 SPEC) */
  defaultExpanded?: string[];
}

/**
 * 渲染产品根目录下"未被结构化解析"的附加 .md 文档(如 SPEC-V1.md / SEAMS.md /
 * DECISIONS.md / RISKS.md / ROADMAP.md / ROLES.md / 等)。
 *
 * 设计动机:atlas v1 schema 只解析 5 类节点(产品/模块/功能点/实体/契约),
 * 没有"接缝/角色矩阵/决策日志/路线图/风险登记"这些一等公民。当用户用补充 .md
 * 兜底时,这个面板让 Web 端也能看到,而不是只在文件系统能访问。
 */
export function AdditionalDocsPanel({ productId, defaultExpanded }: AdditionalDocsPanelProps) {
  const [docs, setDocs] = useState<ExtraDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSet, setOpenSet] = useState<Set<string>>(new Set(defaultExpanded ?? []));

  const load = async () => {
    try {
      const res = await fetch(`/api/products/${productId}/extra-docs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiEnvelope<ExtraDoc[]>;
      setDocs(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  useDataChange(() => {
    void load();
  });

  if (error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
        附加文档加载失败:{error}
      </div>
    );
  }
  if (docs === null) {
    return <div className="text-xs text-slate-500">附加文档加载中...</div>;
  }
  if (docs.length === 0) {
    return null; // 没有附加文档,不渲染面板
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-2 text-sm font-semibold text-slate-950">
        附加规格文档
        <span className="ml-2 text-[11px] font-normal text-slate-500">
          ({docs.length} 份 · atlas v1 schema 暂不解析,仅渲染原文)
        </span>
      </div>
      <ul className="divide-y divide-slate-100">
        {docs.map((d) => {
          const open = openSet.has(d.name);
          return (
            <li key={d.name}>
              <button
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-5 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                onClick={() =>
                  setOpenSet((prev) => {
                    const next = new Set(prev);
                    if (next.has(d.name)) next.delete(d.name);
                    else next.add(d.name);
                    return next;
                  })
                }
                type="button"
              >
                <span className="text-slate-500">{open ? "▾" : "▸"}</span>
                <span className="font-mono text-[13px]">{d.name}</span>
                <span className="ml-auto text-[11px] text-slate-400">
                  {formatSize(d.sizeBytes)}
                </span>
              </button>
              {open ? (
                <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
                  <div className="prose prose-sm max-w-none text-slate-800">
                    <MarkdownRenderer markdown={d.content} />
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
