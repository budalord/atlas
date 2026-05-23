import { useCallback, useEffect, useMemo, useState } from "react";
import { useDataChange } from "../../lib/useDataChange";
import type {
  ActorWithRefs,
  ApiEnvelope,
  CapabilityWithRefs,
  EntitySpec,
  FeaturePoint,
  ModuleWithFeatures,
  UseCase
} from "../../types";

interface MatrixTabProps {
  productId: string;
  readOnly?: boolean;
}

type MatrixKind = "actor-capability" | "actor-entity" | "capability-entity";
type CellLevel = "main" | "occasional" | "unrelated";

interface CellInfo {
  level: CellLevel;
  /** 关联到的 function id 列表(主要 + 偶尔) */
  via_functions: string[];
  /** 关联到的 usecase 列表(actor × * 矩阵用) */
  via_usecases: Array<{ function_id: string; usecase_id: string }>;
}

const LEVEL_COLORS: Record<CellLevel, string> = {
  main: "bg-emerald-600 text-white hover:bg-emerald-700",
  occasional: "bg-emerald-100 text-emerald-900 hover:bg-emerald-200",
  unrelated: "bg-slate-50 text-slate-300"
};
const LEVEL_LABELS: Record<CellLevel, string> = {
  main: "主要",
  occasional: "偶尔",
  unrelated: "无关"
};

/**
 * Matrix tab (v0.1 rev3 五层骨架的关系矩阵视图)。
 *
 * 三矩阵切换:
 *   - Actor × Capability(谁能调用什么能力)
 *   - Actor × Entity(谁能操作什么数据)
 *   - Capability × Entity(什么能力涉及什么对象)
 *
 * 单元格颜色按 docs/matrix-rendering.md §2:
 *   - 主要 emerald-600
 *   - 偶尔 emerald-100
 *   - 无关 slate-50
 *
 * 默认密度过滤"只显示有关联的行/列" + 默认按关联数降序排序。
 *
 * 数据源全前端聚合, 无新 endpoint。
 */
export function MatrixTab({ productId }: MatrixTabProps) {
  const [kind, setKind] = useState<MatrixKind>("actor-capability");
  const [actors, setActors] = useState<ActorWithRefs[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityWithRefs[]>([]);
  const [entities, setEntities] = useState<EntitySpec[]>([]);
  const [functions, setFunctions] = useState<FeaturePoint[]>([]);
  const [usecases, setUsecases] = useState<UseCase[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [denseFilter, setDenseFilter] = useState(true);
  const [showCell, setShowCell] = useState<{
    row: string;
    col: string;
    rowLabel: string;
    colLabel: string;
    cell: CellInfo;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const [aRes, cRes, eRes, uRes, mRes] = await Promise.all([
        fetch(`/api/products/${productId}/actors`),
        fetch(`/api/products/${productId}/capabilities`),
        fetch(`/api/products/${productId}/entities`),
        fetch(`/api/products/${productId}/usecases`),
        fetch(`/api/products/${productId}/modules-with-features`)
      ]);
      if (!aRes.ok) throw new Error(`actors ${aRes.status}`);
      const aJson = (await aRes.json()) as ApiEnvelope<ActorWithRefs[]>;
      const cJson = cRes.ok ? ((await cRes.json()) as ApiEnvelope<CapabilityWithRefs[]>) : null;
      const eJson = eRes.ok ? ((await eRes.json()) as ApiEnvelope<EntitySpec[]>) : null;
      const uJson = uRes.ok ? ((await uRes.json()) as ApiEnvelope<UseCase[]>) : null;
      const mJson = mRes.ok ? ((await mRes.json()) as ApiEnvelope<ModuleWithFeatures[]>) : null;
      setActors(aJson.data);
      setCapabilities(cJson?.data ?? []);
      setEntities(eJson?.data ?? []);
      setUsecases(uJson?.data ?? []);
      // 把 FeaturePointPreview 当 FeaturePoint 简化用(只需 id/actor_ids/entities_touched/capability_id)
      const allFunctions = (mJson?.data ?? []).flatMap((m) => m.features) as unknown as FeaturePoint[];
      setFunctions(allFunctions);
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

  // 构造矩阵: rows + cols + cellsByKey
  const matrix = useMemo(() => {
    return buildMatrix(kind, actors, capabilities, entities, functions, usecases);
  }, [kind, actors, capabilities, entities, functions, usecases]);

  // 密度过滤 + 关联数降序排序
  const view = useMemo(() => {
    const { rows, cols, cells, rowCounts, colCounts } = matrix;
    let rs = rows;
    let cs = cols;
    if (denseFilter) {
      rs = rows.filter((r) => (rowCounts.get(r.id) ?? 0) > 0);
      cs = cols.filter((c) => (colCounts.get(c.id) ?? 0) > 0);
    }
    rs = [...rs].sort(
      (a, b) =>
        (rowCounts.get(b.id) ?? 0) - (rowCounts.get(a.id) ?? 0) || a.id.localeCompare(b.id)
    );
    cs = [...cs].sort(
      (a, b) =>
        (colCounts.get(b.id) ?? 0) - (colCounts.get(a.id) ?? 0) || a.id.localeCompare(b.id)
    );
    return { rows: rs, cols: cs, cells };
  }, [matrix, denseFilter]);

  if (error) return <div className="p-5 text-sm text-rose-700">{error}</div>;

  const totalCells = view.rows.length * view.cols.length;
  const mainCount = Array.from(matrix.cells.values()).filter((c) => c.level === "main").length;
  const occCount = Array.from(matrix.cells.values()).filter((c) => c.level === "occasional").length;

  return (
    <div className="flex h-[calc(100vh-200px)] min-h-0 flex-col overflow-hidden">
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-2.5">
        <div className="flex items-center gap-1">
          <KindButton active={kind === "actor-capability"} onClick={() => setKind("actor-capability")}>
            角色 × 能力
          </KindButton>
          <KindButton active={kind === "actor-entity"} onClick={() => setKind("actor-entity")}>
            角色 × 实体
          </KindButton>
          <KindButton active={kind === "capability-entity"} onClick={() => setKind("capability-entity")}>
            能力 × 实体
          </KindButton>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <label className="flex items-center gap-1.5">
            <input
              checked={denseFilter}
              onChange={(e) => setDenseFilter(e.target.checked)}
              type="checkbox"
            />
            只显示有关联的行/列
          </label>
          <span>
            主要 <span className="font-semibold text-emerald-700">{mainCount}</span> · 偶尔{" "}
            <span className="font-semibold text-emerald-700">{occCount}</span> · 合计{" "}
            <span className="font-mono text-slate-700">
              {view.rows.length}×{view.cols.length}={totalCells}
            </span>
          </span>
        </div>
      </div>

      {/* 矩阵主体 */}
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {view.rows.length === 0 || view.cols.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-center text-[13px] text-slate-500">
            该矩阵没有有效行/列。 检查是否漏建 actor / capability / entity。
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
            <table className="border-collapse text-[11px]">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr>
                  <th className="sticky left-0 z-20 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-medium text-slate-500">
                    {matrix.rowKindLabel} \ {matrix.colKindLabel}
                  </th>
                  {view.cols.map((col) => (
                    <th
                      key={col.id}
                      className="border-b border-slate-200 px-1 py-2 text-left align-bottom font-medium text-slate-700"
                      title={`${col.name} (${col.id})`}
                    >
                      <div className="flex h-[140px] flex-row items-end gap-1 whitespace-nowrap">
                        {/* 中文名 — 字符直立, 上→下 */}
                        <span
                          className="text-[11px] text-slate-700"
                          style={{
                            writingMode: "vertical-rl",
                            textOrientation: "upright",
                            letterSpacing: "0.05em"
                          }}
                        >
                          {col.name}
                        </span>
                        {/* 英文 id — 自然 90° 顺时针(头朝右), 上→下 */}
                        <code
                          className="font-mono text-[9px] text-slate-400"
                          style={{ writingMode: "vertical-rl" }}
                        >
                          {col.id}
                        </code>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr key={row.id} className="even:bg-slate-50/30">
                    <th className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-1.5 text-left font-medium text-slate-700 even:bg-slate-50/30">
                      <div className="flex flex-col">
                        <span>{row.name}</span>
                        <code className="text-[9px] font-normal text-slate-400">{row.id}</code>
                      </div>
                    </th>
                    {view.cols.map((col) => {
                      const key = `${row.id}::${col.id}`;
                      const cell = matrix.cells.get(key) ?? { level: "unrelated", via_functions: [], via_usecases: [] };
                      const cls = LEVEL_COLORS[cell.level];
                      return (
                        <td
                          key={key}
                          className={`cursor-pointer border-r border-slate-100 text-center transition ${cls}`}
                          onClick={() => {
                            if (cell.level !== "unrelated") {
                              setShowCell({
                                row: row.id,
                                col: col.id,
                                rowLabel: row.name,
                                colLabel: col.name,
                                cell
                              });
                            }
                          }}
                          title={`${row.name} × ${col.name}: ${LEVEL_LABELS[cell.level]}${
                            cell.via_functions.length > 0
                              ? ` · ${cell.via_functions.length} function`
                              : ""
                          }`}
                        >
                          <div className="px-2 py-1.5 text-[10px]">
                            {cell.level === "main" ? "●" : cell.level === "occasional" ? "○" : ""}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 单元格 detail 弹窗 */}
      {showCell ? (
        <CellDetailPopover
          cell={showCell.cell}
          colLabel={showCell.colLabel}
          rowLabel={showCell.rowLabel}
          onClose={() => setShowCell(null)}
          functions={functions}
        />
      ) : null}
    </div>
  );
}

function KindButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rounded px-3 py-1 text-[12px] font-medium ${
        active
          ? "bg-slate-900 text-white"
          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CellDetailPopover({
  rowLabel,
  colLabel,
  cell,
  functions,
  onClose
}: {
  rowLabel: string;
  colLabel: string;
  cell: CellInfo;
  functions: FeaturePoint[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[600px] max-w-[90vw] rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-slate-200 px-5 py-3">
          <div className="text-[10px] text-slate-500">{LEVEL_LABELS[cell.level]} · 单元格详情</div>
          <h3 className="mt-0.5 text-base font-semibold text-slate-900">
            {rowLabel} × {colLabel}
          </h3>
        </header>
        <div className="space-y-3 px-5 py-4 text-[12px]">
          <section>
            <div className="text-[11px] font-medium text-slate-700">关联 functions ({cell.via_functions.length})</div>
            {cell.via_functions.length === 0 ? (
              <div className="mt-1 text-[11px] italic text-slate-400">—</div>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {cell.via_functions.map((fid) => {
                  const fn = functions.find((f) => f.id === fid);
                  return (
                    <li key={fid} className="flex items-center gap-2">
                      <code className="font-mono text-[10px] text-slate-500">{fid}</code>
                      {fn ? <span className="text-slate-800">{fn.name}</span> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          {cell.via_usecases.length > 0 ? (
            <section>
              <div className="text-[11px] font-medium text-slate-700">
                关联 usecases ({cell.via_usecases.length})
              </div>
              <ul className="mt-1 space-y-0.5">
                {cell.via_usecases.map((u) => (
                  <li key={`${u.function_id}/${u.usecase_id}`} className="flex items-center gap-2">
                    <code className="font-mono text-[10px] text-slate-500">{u.function_id}</code>
                    <span className="text-slate-300">/</span>
                    <code className="font-mono text-[10px] text-slate-700">{u.usecase_id}</code>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <footer className="border-t border-slate-200 px-5 py-2.5">
          <button
            className="rounded px-3 py-1 text-[11px] text-slate-600 hover:text-slate-900"
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ============================================================
 *  矩阵构造 — 按 docs/matrix-rendering.md §2 规则 9
 * ============================================================ */

interface MatrixModel {
  rows: { id: string; name: string }[];
  cols: { id: string; name: string }[];
  cells: Map<string, CellInfo>;
  rowKindLabel: string;
  colKindLabel: string;
  rowCounts: Map<string, number>;
  colCounts: Map<string, number>;
}

function buildMatrix(
  kind: MatrixKind,
  actors: ActorWithRefs[],
  capabilities: CapabilityWithRefs[],
  entities: EntitySpec[],
  functions: FeaturePoint[],
  usecases: UseCase[]
): MatrixModel {
  switch (kind) {
    case "actor-capability":
      return buildActorCapability(actors, capabilities, functions, usecases);
    case "actor-entity":
      return buildActorEntity(actors, capabilities, entities, functions);
    case "capability-entity":
      return buildCapabilityEntity(capabilities, entities, functions);
  }
}

function buildActorCapability(
  actors: ActorWithRefs[],
  capabilities: CapabilityWithRefs[],
  functions: FeaturePoint[],
  usecases: UseCase[]
): MatrixModel {
  const cells = new Map<string, CellInfo>();
  const rowCounts = new Map<string, number>();
  const colCounts = new Map<string, number>();
  for (const a of actors) {
    for (const c of capabilities) {
      const key = `${a.id}::${c.id}`;
      const isMain = c.actor_ids.includes(a.id);
      const capFns = functions.filter((f) => c.function_ids.includes(f.id));
      const viaFn = capFns.filter((f) => (f.actor_ids ?? f.roles ?? []).includes(a.id)).map((f) => f.id);
      const viaUc = usecases
        .filter((u) => capFns.some((f) => f.id === u.function_id) && u.actor_id === a.id)
        .map((u) => ({ function_id: u.function_id, usecase_id: u.id }));
      let level: CellLevel = "unrelated";
      if (isMain) level = "main";
      else if (viaFn.length > 0 || viaUc.length > 0) level = "occasional";
      if (level !== "unrelated") {
        cells.set(key, { level, via_functions: viaFn, via_usecases: viaUc });
        rowCounts.set(a.id, (rowCounts.get(a.id) ?? 0) + 1);
        colCounts.set(c.id, (colCounts.get(c.id) ?? 0) + 1);
      }
    }
  }
  return {
    rows: actors.map((a) => ({ id: a.id, name: a.name })),
    cols: capabilities.map((c) => ({ id: c.id, name: c.name })),
    cells,
    rowKindLabel: "角色",
    colKindLabel: "能力",
    rowCounts,
    colCounts
  };
}

function buildActorEntity(
  actors: ActorWithRefs[],
  capabilities: CapabilityWithRefs[],
  entities: EntitySpec[],
  functions: FeaturePoint[]
): MatrixModel {
  // 收集所有引用的 entity 名(派生层可能为空; 取 capabilities + functions 的并集)
  const entitySet = new Set<string>();
  for (const c of capabilities) for (const e of c.entity_ids) entitySet.add(e);
  for (const f of functions) for (const e of f.entities_touched ?? []) entitySet.add(e);
  const allEntities = Array.from(entitySet).sort();

  const cells = new Map<string, CellInfo>();
  const rowCounts = new Map<string, number>();
  const colCounts = new Map<string, number>();

  for (const a of actors) {
    for (const eid of allEntities) {
      const key = `${a.id}::${eid}`;
      // main: 存在 capability C 使得 a.id ∈ C.actor_ids ∧ eid ∈ C.entity_ids
      const mainCaps = capabilities.filter(
        (c) => c.actor_ids.includes(a.id) && c.entity_ids.includes(eid)
      );
      const isMain = mainCaps.length > 0;
      // occasional: 存在 function f 使得 a.id ∈ f.actor_ids ∧ eid ∈ f.entities_touched
      const occFns = functions
        .filter((f) => (f.actor_ids ?? f.roles ?? []).includes(a.id))
        .filter((f) => (f.entities_touched ?? []).includes(eid));
      const viaFn = occFns.map((f) => f.id);
      let level: CellLevel = "unrelated";
      if (isMain) level = "main";
      else if (viaFn.length > 0) level = "occasional";
      if (level !== "unrelated") {
        cells.set(key, { level, via_functions: viaFn, via_usecases: [] });
        rowCounts.set(a.id, (rowCounts.get(a.id) ?? 0) + 1);
        colCounts.set(eid, (colCounts.get(eid) ?? 0) + 1);
      }
    }
  }
  return {
    rows: actors.map((a) => ({ id: a.id, name: a.name })),
    cols: allEntities.map((e) => {
      const ent = entities.find((x) => x.name === e);
      return { id: e, name: ent ? `${e}${ent ? "" : "⚠"}` : `${e} ⚠未派生` };
    }),
    cells,
    rowKindLabel: "角色",
    colKindLabel: "实体",
    rowCounts,
    colCounts
  };
}

function buildCapabilityEntity(
  capabilities: CapabilityWithRefs[],
  entities: EntitySpec[],
  functions: FeaturePoint[]
): MatrixModel {
  const entitySet = new Set<string>();
  for (const c of capabilities) for (const e of c.entity_ids) entitySet.add(e);
  for (const f of functions) for (const e of f.entities_touched ?? []) entitySet.add(e);
  const allEntities = Array.from(entitySet).sort();

  const cells = new Map<string, CellInfo>();
  const rowCounts = new Map<string, number>();
  const colCounts = new Map<string, number>();

  for (const c of capabilities) {
    const capFns = functions.filter((f) => c.function_ids.includes(f.id));
    for (const eid of allEntities) {
      const key = `${c.id}::${eid}`;
      const isMain = c.entity_ids.includes(eid);
      const occFns = capFns.filter((f) => (f.entities_touched ?? []).includes(eid));
      const viaFn = occFns.map((f) => f.id);
      let level: CellLevel = "unrelated";
      if (isMain) level = "main";
      else if (viaFn.length > 0) level = "occasional";
      if (level !== "unrelated") {
        cells.set(key, { level, via_functions: viaFn, via_usecases: [] });
        rowCounts.set(c.id, (rowCounts.get(c.id) ?? 0) + 1);
        colCounts.set(eid, (colCounts.get(eid) ?? 0) + 1);
      }
    }
  }
  return {
    rows: capabilities.map((c) => ({ id: c.id, name: c.name })),
    cols: allEntities.map((e) => {
      const ent = entities.find((x) => x.name === e);
      return { id: e, name: ent ? e : `${e} ⚠未派生` };
    }),
    cells,
    rowKindLabel: "能力",
    colKindLabel: "实体",
    rowCounts,
    colCounts
  };
}
