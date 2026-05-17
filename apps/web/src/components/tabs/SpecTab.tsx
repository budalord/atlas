import { useCallback, useEffect, useMemo, useState } from "react";
import { useDataChange } from "../../lib/useDataChange";
import type { ApiEnvelope, SpecFile, SpecFileKind } from "../../types";
import { MarkdownRenderer } from "../MarkdownRenderer";

interface SpecTabProps {
  productId: string;
  readOnly?: boolean;
}

type SubTabKey = "decisions-warnings" | "cross-module" | "evolution-risks";

const SUB_TABS: Array<{ key: SubTabKey; label: string; kinds: SpecFileKind[] }> = [
  {
    key: "decisions-warnings",
    label: "决策与警告",
    kinds: ["decisions", "architectural-warnings"]
  },
  {
    key: "cross-module",
    label: "跨模块契约",
    kinds: ["seams", "entities-ownership"]
  },
  {
    key: "evolution-risks",
    label: "演进与风险",
    kinds: ["evolution-principles", "ai-requirements", "risks"]
  }
];

const KIND_TITLE: Record<SpecFileKind, string> = {
  decisions: "决策日志(DECISIONS.md)",
  "architectural-warnings": "架构警告(ARCHITECTURAL-WARNINGS.md)",
  seams: "跨模块接缝契约(SEAMS.md)",
  "entities-ownership": "实体归属清单(ENTITIES-OWNERSHIP.md)",
  "evolution-principles": "演进式设计原则(EVOLUTION-PRINCIPLES.md)",
  "ai-requirements": "AI 工作流需求(AI-REQUIREMENTS.md)",
  risks: "风险登记(RISKS.md)"
};

/**
 * 规格 tab — 展示产品规格层(Layer 2)7 类标准文件。
 *
 * - 数据来自 GET /api/products/:id/spec-files
 * - 阶段 1 只读渲染 markdown(后续阶段 3/5/6 会替换为结构化卡片)
 * - 文件不存在时显示空态(不阻塞)
 */
export function SpecTab({ productId }: SpecTabProps) {
  const [files, setFiles] = useState<SpecFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sub, setSub] = useState<SubTabKey>("decisions-warnings");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productId}/spec-files`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiEnvelope<SpecFile[]>;
      setFiles(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [productId]);

  useEffect(() => {
    setFiles(null);
    void load();
  }, [load]);

  useDataChange(() => {
    void load();
  });

  const byKind = useMemo(() => {
    const map = new Map<SpecFileKind, SpecFile>();
    (files ?? []).forEach((f) => map.set(f.kind, f));
    return map;
  }, [files]);

  if (error) return <div className="p-5 text-sm text-rose-700">{error}</div>;
  if (files === null) return <div className="p-5 text-xs text-slate-500">加载中...</div>;

  const activeSub = SUB_TABS.find((s) => s.key === sub) ?? SUB_TABS[0];

  return (
    <section className="space-y-4 p-6">
      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-[11px] leading-5 text-slate-500">
        本 tab 的目标读者:架构师 + 派生 Agent。产品级横切信息(决策 / 接缝 / 实体归属 / 警告 / 演进 /
        AI / 风险),Atlas 自 v2 起承载,功能点级内容仍在功能点 tab。
      </div>

      <nav className="flex flex-wrap items-center gap-1 border-b border-slate-200">
        {SUB_TABS.map((s) => {
          const active = s.key === sub;
          const count = s.kinds.filter((k) => byKind.get(k)?.exists).length;
          return (
            <button
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
                active
                  ? "border-slate-900 font-semibold text-slate-950"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
              key={s.key}
              onClick={() => setSub(s.key)}
              type="button"
            >
              {s.label}
              <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-normal text-slate-500">
                {count}/{s.kinds.length}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="space-y-4">
        {activeSub.kinds.map((kind) => {
          const file = byKind.get(kind);
          if (!file) return null;
          return <SpecFileCard file={file} key={kind} />;
        })}
      </div>
    </section>
  );
}

function SpecFileCard({ file }: { file: SpecFile }) {
  const [open, setOpen] = useState(file.exists);
  const title = KIND_TITLE[file.kind];
  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-2 border-b border-slate-200 px-5 py-2 text-left text-sm font-semibold text-slate-950 hover:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="text-slate-500">{open ? "▾" : "▸"}</span>
        <span>{title}</span>
        {!file.exists ? (
          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-500">
            未填写
          </span>
        ) : null}
        {file.last_modified ? (
          <span className="ml-auto text-[10px] font-normal text-slate-400">
            {formatTime(file.last_modified)}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="p-5">
          {file.exists ? (
            <div className="prose prose-sm max-w-none text-slate-800">
              <MarkdownRenderer markdown={file.content} />
            </div>
          ) : (
            <div className="text-[12px] leading-5 text-slate-500">
              未填写,可在文件系统创建 <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">{file.filename}</code>
              。文件保存后,Atlas 通过 watcher 自动同步并在此渲染。
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 16).replace("T", " ");
  } catch {
    return iso;
  }
}
