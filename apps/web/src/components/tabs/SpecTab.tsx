import { useCallback, useEffect, useMemo, useState } from "react";
import { useDataChange } from "../../lib/useDataChange";
import type {
  ApiEnvelope,
  ArchitecturalWarning,
  ArchitecturalWarningsData,
  Decision,
  DecisionStatus,
  EntitiesOwnershipData,
  ModuleWithFeatures,
  OwnershipRow,
  Seam,
  SpecFile,
  SpecFileKind,
  WarningStatus
} from "../../types";
import { MarkdownRenderer } from "../MarkdownRenderer";

interface SpecTabProps {
  productId: string;
  /** readOnly 保留参数兼容(phase 决定),但本 tab 设计为只看不改,不再消费 */
  readOnly?: boolean;
}

type SubTabKey = "decisions-warnings" | "cross-module" | "evolution-risks";

const SUB_TABS: Array<{ key: SubTabKey; label: string }> = [
  { key: "decisions-warnings", label: "决策与警告" },
  { key: "cross-module", label: "跨模块契约" },
  { key: "evolution-risks", label: "演进与风险" }
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
 * 规格 tab —— **只读** 展示产品规格层(Layer 2)7 类标准文件。
 *
 * 设计:Atlas 不在此 tab 提供任何编辑入口。Claude 在思维碰撞后直接写盘对应 md
 * 文件,Atlas watcher 自动刷新。派生 Agent(实体 / 原型)将这些文件作为参考资料消费。
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
        本 tab 是 <span className="font-medium text-slate-700">Agent 派生参考资料</span>(决策 / 警告 / 接缝 / 实体归属 / 演进 / AI / 风险)。
        Claude 思维碰撞后直接写盘对应文件,Atlas watcher 自动同步;派生 Agent 消费这些文件生成实体 / 原型。
        <span className="ml-1 font-medium text-slate-700">日常开发请用功能点 tab</span>。
      </div>

      <nav className="flex flex-wrap items-center gap-1 border-b border-slate-200">
        {SUB_TABS.map((s) => {
          const active = s.key === sub;
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
            </button>
          );
        })}
      </nav>

      {activeSub.key === "decisions-warnings" ? (
        <DecisionsPanel productId={productId} />
      ) : null}
      {activeSub.key === "decisions-warnings" ? (
        <WarningsPanel productId={productId} />
      ) : null}

      {activeSub.key === "cross-module" ? (
        <SeamsPanel productId={productId} />
      ) : null}
      {activeSub.key === "cross-module" ? (
        <OwnershipPanel productId={productId} />
      ) : null}

      {activeSub.key === "evolution-risks" ? (
        <>
          <SpecFileCard file={byKind.get("evolution-principles")} kind="evolution-principles" />
          <SpecFileCard file={byKind.get("ai-requirements")} kind="ai-requirements" />
          <SpecFileCard file={byKind.get("risks")} kind="risks" />
        </>
      ) : null}
    </section>
  );
}

/* ============================================================
 *  通用规格文件卡片(用于 EVOLUTION / AI-REQUIREMENTS / RISKS)
 * ============================================================ */
function SpecFileCard({ file, kind }: { file: SpecFile | undefined; kind: SpecFileKind }) {
  const [open, setOpen] = useState<boolean>(false);
  const title = KIND_TITLE[kind];
  const exists = file?.exists ?? false;
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
        {!exists ? (
          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-500">
            未填写
          </span>
        ) : null}
        {file?.last_modified ? (
          <span className="ml-auto text-[10px] font-normal text-slate-400">
            {formatTime(file.last_modified)}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="p-5">
          {exists && file ? (
            <div className="prose prose-sm max-w-none text-slate-800">
              <MarkdownRenderer markdown={file.content} />
            </div>
          ) : (
            <div className="text-[12px] leading-5 text-slate-500">
              未填写。Claude 思维碰撞后会写入{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">{file?.filename ?? ""}</code>
              。文件保存后,Atlas 通过 watcher 自动同步并在此渲染。
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================
 *  决策面板(DECISIONS.md 只读展示)
 * ============================================================ */
interface DecisionsResp {
  exists: boolean;
  decisions: Decision[];
  last_modified: string | null;
}

function DecisionsPanel({ productId }: { productId: string }) {
  const [data, setData] = useState<DecisionsResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productId}/decisions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiEnvelope<DecisionsResp>;
      setData(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  useDataChange(() => {
    void load();
  });

  if (error) return <div className="text-sm text-rose-700">{error}</div>;
  if (data === null) return <div className="text-xs text-slate-500">加载中...</div>;

  // 倒序:D-N 大的在前
  const reversed = [...data.decisions].sort((a, b) => decisionNum(b.id) - decisionNum(a.id));

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-2 text-sm font-semibold text-slate-950">
        决策日志(DECISIONS.md)
        <span className="ml-2 text-[11px] font-normal text-slate-500">
          {data.exists ? `${data.decisions.length} 条` : "未填写"}
        </span>
      </div>

      {!data.exists ? (
        <div className="px-5 py-4 text-[12px] leading-5 text-slate-500">
          未填写。Claude 思维碰撞后会写入 <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">DECISIONS.md</code>。
        </div>
      ) : null}

      {reversed.length > 0 ? (
        <ul className="divide-y divide-slate-100">
          {reversed.map((d) => (
            <li key={d.id}>
              <DecisionCard decision={d} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function DecisionCard({ decision }: { decision: Decision }) {
  const [open, setOpen] = useState(false);
  const statusTone: Record<DecisionStatus, string> = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    superseded: "bg-amber-50 text-amber-700 border-amber-200",
    archived: "bg-slate-100 text-slate-500 border-slate-300"
  };

  return (
    <div>
      <button
        className="flex w-full items-baseline gap-3 px-5 py-2 text-left hover:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="text-slate-500">{open ? "▾" : "▸"}</span>
        <span className="font-mono text-[12px] font-semibold text-slate-900">{decision.id}</span>
        {decision.date ? <span className="text-[11px] text-slate-400">{decision.date}</span> : null}
        <span className="flex-1 truncate text-[13px] text-slate-800">{decision.title}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${statusTone[decision.status]}`}>
          {decision.status}
        </span>
      </button>
      {open ? (
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-4 text-[13px] leading-6 text-slate-800">
          {decision.summary ? (
            <div className="mb-2">
              <span className="text-[11px] font-semibold text-slate-500">决策摘要</span>
              <p className="mt-0.5">{decision.summary}</p>
            </div>
          ) : null}
          {decision.affectedFeatures.length > 0 ? (
            <div className="mb-2">
              <span className="text-[11px] font-semibold text-slate-500">影响 features</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {decision.affectedFeatures.map((f) => (
                  <code
                    key={f}
                    className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[11px] text-slate-700"
                  >
                    {f}
                  </code>
                ))}
              </div>
            </div>
          ) : null}
          {decision.sourceRef ? (
            <div className="mb-2">
              <span className="text-[11px] font-semibold text-slate-500">来源段</span>
              <p className="mt-0.5 font-mono text-[12px] text-slate-600">{decision.sourceRef}</p>
            </div>
          ) : null}
          {decision.body ? (
            <div className="mt-3 prose prose-sm max-w-none">
              <MarkdownRenderer markdown={decision.body} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================
 *  架构警告面板(ARCHITECTURAL-WARNINGS.md 只读展示)
 * ============================================================ */
function WarningsPanel({ productId }: { productId: string }) {
  const [data, setData] = useState<ArchitecturalWarningsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productId}/architectural-warnings`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiEnvelope<ArchitecturalWarningsData>;
      setData(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  useDataChange(() => {
    void load();
  });

  if (error) return <div className="text-sm text-rose-700">{error}</div>;
  if (data === null) return <div className="text-xs text-slate-500">加载中...</div>;

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-2 text-sm font-semibold text-slate-950">
        架构警告(ARCHITECTURAL-WARNINGS.md)
        <span className="ml-2 text-[11px] font-normal text-slate-500">
          {data.exists ? `${data.warnings.length} 条` : "未填写"}
        </span>
      </div>

      {!data.exists ? (
        <div className="px-5 py-4 text-[12px] leading-5 text-slate-500">
          未填写。Claude 思维碰撞后会写入 <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">ARCHITECTURAL-WARNINGS.md</code>。
        </div>
      ) : null}

      {data.warnings.length > 0 ? (
        <ul className="divide-y divide-slate-100">
          {data.warnings.map((w) => (
            <li key={w.id}>
              <WarningCard warning={w} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function WarningCard({ warning }: { warning: ArchitecturalWarning }) {
  const [open, setOpen] = useState(false);
  const statusTone: Record<WarningStatus, string> = {
    待承接: "bg-rose-50 text-rose-700 border-rose-200",
    部分承接: "bg-amber-50 text-amber-700 border-amber-200",
    已纳入: "bg-emerald-50 text-emerald-700 border-emerald-200"
  };

  return (
    <div>
      <button
        className="flex w-full items-baseline gap-3 px-5 py-2 text-left hover:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="text-slate-500">{open ? "▾" : "▸"}</span>
        <span className="font-mono text-[12px] font-semibold text-slate-900">警告 {warning.id}</span>
        <span className="flex-1 truncate text-[13px] text-slate-800">{warning.title}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${statusTone[warning.status]}`}>
          {warning.status}
        </span>
      </button>
      {open ? (
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-4 text-[13px] leading-6 text-slate-800">
          {warning.originalQuote ? (
            <div className="mb-3">
              <div className="text-[11px] font-semibold text-slate-500">原话</div>
              <blockquote className="mt-1 border-l-4 border-slate-300 bg-white px-3 py-2 text-slate-700">
                {warning.originalQuote}
              </blockquote>
            </div>
          ) : null}
          {warning.interpretation ? (
            <div className="mb-3">
              <div className="text-[11px] font-semibold text-slate-500">原意</div>
              <div className="mt-1 prose prose-sm max-w-none">
                <MarkdownRenderer markdown={warning.interpretation} />
              </div>
            </div>
          ) : null}
          {warning.resolution ? (
            <div className="mb-3">
              <div className="text-[11px] font-semibold text-slate-500">整体规格承接</div>
              <div className="mt-1 prose prose-sm max-w-none">
                <MarkdownRenderer markdown={warning.resolution} />
              </div>
            </div>
          ) : null}
          {warning.implication ? (
            <div className="mb-3">
              <div className="text-[11px] font-semibold text-slate-500">含义</div>
              <div className="mt-1 prose prose-sm max-w-none">
                <MarkdownRenderer markdown={warning.implication} />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================
 *  接缝面板(SEAMS.md 只读展示)
 * ============================================================ */
interface SeamsResp {
  exists: boolean;
  seams: Seam[];
  last_modified: string | null;
}

function SeamsPanel({ productId }: { productId: string }) {
  const [data, setData] = useState<SeamsResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productId}/seams`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiEnvelope<SeamsResp>;
      setData(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  useDataChange(() => {
    void load();
  });

  if (error) return <div className="text-sm text-rose-700">{error}</div>;
  if (data === null) return <div className="text-xs text-slate-500">加载中...</div>;

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-2 text-sm font-semibold text-slate-950">
        跨模块接缝契约(SEAMS.md)
        <span className="ml-2 text-[11px] font-normal text-slate-500">
          {data.exists ? `${data.seams.length} 个接缝` : "未填写"}
        </span>
      </div>

      {!data.exists ? (
        <div className="px-5 py-4 text-[12px] leading-5 text-slate-500">
          未填写。Claude 思维碰撞后会写入 <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">SEAMS.md</code>。
        </div>
      ) : null}

      {data.seams.length > 0 ? (
        <ul className="divide-y divide-slate-100">
          {data.seams.map((s) => (
            <li key={s.id}>
              <SeamCard seam={s} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SeamCard({ seam }: { seam: Seam }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        className="flex w-full items-baseline gap-3 px-5 py-2 text-left hover:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="text-slate-500">{open ? "▾" : "▸"}</span>
        <span className="font-mono text-[12px] font-semibold text-slate-900">{seam.id}</span>
        <span className="flex-1 truncate text-[13px] text-slate-800">{seam.title}</span>
        {seam.caller || seam.callee ? (
          <span className="text-[11px] text-slate-500">
            {seam.caller ? truncate(seam.caller, 18) : "?"} → {seam.callee ? truncate(seam.callee, 18) : "?"}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
          <div className="prose prose-sm max-w-none text-slate-800">
            <MarkdownRenderer markdown={seam.body} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================
 *  实体归属表(ENTITIES-OWNERSHIP.md 只读 + 筛选 + 反查 features)
 * ============================================================ */
function OwnershipPanel({ productId }: { productId: string }) {
  const [data, setData] = useState<EntitiesOwnershipData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modules, setModules] = useState<ModuleWithFeatures[] | null>(null);
  const [layerFilter, setLayerFilter] = useState<string>("__all__");

  const load = useCallback(async () => {
    try {
      const [r1, r2] = await Promise.all([
        fetch(`/api/products/${productId}/entities-ownership`),
        fetch(`/api/products/${productId}/modules-with-features`).catch(() => null)
      ]);
      if (!r1.ok) throw new Error(`HTTP ${r1.status}`);
      const json = (await r1.json()) as ApiEnvelope<EntitiesOwnershipData>;
      setData(json.data);
      if (r2 && r2.ok) {
        const m = (await r2.json()) as ApiEnvelope<ModuleWithFeatures[]>;
        setModules(m.data);
      } else {
        setModules(null);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  useDataChange(() => {
    void load();
  });

  // 反查:entity name → 引用它的 feature id 列表
  const featuresByEntity = useMemo(() => {
    const map = new Map<string, string[]>();
    (modules ?? []).forEach((mw) => {
      mw.features.forEach((f) => {
        (f.entities_touched ?? []).forEach((ent) => {
          const arr = map.get(ent) ?? [];
          if (!arr.includes(f.id)) arr.push(f.id);
          map.set(ent, arr);
        });
      });
    });
    return map;
  }, [modules]);

  const layerOptions = useMemo(() => {
    const set = new Set<string>();
    (data?.rows ?? []).forEach((r) => {
      if (r.kind === "entity" && r.layer) set.add(r.layer);
    });
    return Array.from(set).sort();
  }, [data]);

  const groupCount = useMemo(() => {
    return (data?.rows ?? []).filter((r) => r.kind === "group").length;
  }, [data]);

  if (error) return <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>;
  if (data === null) return <div className="text-xs text-slate-500">加载中...</div>;

  const filteredRows = layerFilter === "__all__"
    ? data.rows
    : data.rows.filter((r) => r.kind === "group" || (r.kind === "entity" && r.layer === layerFilter));
  const entityCount = data.rows.filter((r) => r.kind === "entity").length;

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-2">
        <div className="text-sm font-semibold text-slate-950">
          实体归属清单(ENTITIES-OWNERSHIP.md)
          <span className="ml-2 text-[11px] font-normal text-slate-500">
            {data.exists ? `${entityCount} 个实体 · ${groupCount} 个分组` : "未填写"}
          </span>
        </div>
        {layerOptions.length > 0 ? (
          <div className="flex items-center gap-2 text-[11px]">
            <label className="text-slate-500">筛选:</label>
            <select
              className="rounded border border-slate-300 bg-white px-1.5 py-0.5"
              onChange={(e) => setLayerFilter(e.target.value)}
              value={layerFilter}
            >
              <option value="__all__">全部</option>
              {layerOptions.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {!data.exists ? (
        <div className="px-5 py-4 text-[12px] leading-5 text-slate-500">
          未填写。Claude 思维碰撞后会写入{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">ENTITIES-OWNERSHIP.md</code>。
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-auto text-[12px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
                <th className="px-3 py-1.5 font-medium">实体</th>
                <th className="px-3 py-1.5 font-medium">归属</th>
                <th className="px-3 py-1.5 font-medium">维护权限</th>
                <th className="px-3 py-1.5 font-medium">备注</th>
                <th className="px-3 py-1.5 font-medium">影响 features</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, idx) => (
                <OwnershipRowItem
                  affectedFeatures={
                    row.kind === "entity" ? featuresByEntity.get(row.name) ?? [] : []
                  }
                  key={row.kind === "group" ? `g-${row.name}-${idx}` : `e-${row.name}`}
                  row={row}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.trailing ? (
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
          <div className="mb-2 text-[11px] font-semibold text-slate-500">补充段落</div>
          <div className="prose prose-sm max-w-none text-slate-800">
            <MarkdownRenderer markdown={data.trailing} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OwnershipRowItem({
  row,
  affectedFeatures
}: {
  row: OwnershipRow;
  affectedFeatures: string[];
}) {
  if (row.kind === "group") {
    return (
      <tr className="border-b border-slate-100 bg-slate-100/50">
        <td className="px-3 py-1.5 font-semibold text-slate-700" colSpan={5}>
          {row.name}
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-slate-100 align-top hover:bg-slate-50">
      <td className="px-3 py-1.5">
        <span className="font-mono text-[12px] font-semibold text-slate-900">{row.name}</span>
        {row.alias ? <span className="ml-1 text-[11px] text-slate-500">({row.alias})</span> : null}
      </td>
      <td className="px-3 py-1.5 text-slate-800">{row.layer}</td>
      <td className="px-3 py-1.5 text-slate-700">{row.maintainers}</td>
      <td className="px-3 py-1.5 text-slate-600">{row.note}</td>
      <td className="px-3 py-1.5">
        {affectedFeatures.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {affectedFeatures.map((fid) => (
              <code
                className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-700"
                key={fid}
                title={fid}
              >
                {fid}
              </code>
            ))}
          </div>
        ) : (
          <span className="text-[10px] italic text-slate-400">—</span>
        )}
      </td>
    </tr>
  );
}

/* ============================================================ */

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 16).replace("T", " ");
  } catch {
    return iso;
  }
}

function decisionNum(id: string): number {
  const m = id.match(/^D-(\d+)$/);
  return m ? parseInt(m[1], 10) : -1;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
