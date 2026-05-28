import { parseEntityMarkdown } from "./entityParser";
import { parseFeatureMarkdown } from "./featureParser";
import { parseScreen } from "./screenLoader";
import { parseUseCase } from "./usecaseLoader";

/**
 * v0.2c §5.5: 把 before/after markdown 解析成字段/段级别 diff, 生成业务级摘要
 * 给 ReviewChangesetModal 用 — PM 不用看 raw diff 也能读懂 "Student 加 5 字段 / 删 2".
 *
 * 输出统一格式: { added/removed/changed: string[] }, 元素是字段名 / 段名。
 * 不同 scope 解析策略不同:
 * - entity: 解析 `## 字段` 表 + frontmatter, by field name diff
 * - feature: 解析 frontmatter (entities_touched / actor_ids) + `## 描述` 长度变化
 * - screen: frontmatter entity_visibility / usecase_ids 变化
 * - usecase: frontmatter precondition/postcondition + body 长度
 * - actor / 其他: 退化成"正文行数变化"
 */

export interface ChangeSummary {
  /** 一行业务级摘要文字, e.g. "加 5 字段 (a, b, c, d, e) · 删 2 (x, y)" */
  line: string;
  /** 结构化, UI 可分别渲染 */
  added: string[];
  removed: string[];
  changed: string[];
  /** kind 决定 UI 用什么图标 */
  kind: "field-diff" | "ref-diff" | "section-diff" | "text-diff" | "create" | "delete";
}

export type DiffScope = "feature" | "entity" | "usecase" | "screen" | "actor";

/**
 * 推断 scope 从相对路径 (e.g. modules/sales/features/foo.md → "feature").
 */
export function inferScopeFromPath(relPath: string): DiffScope | null {
  if (/\/features\/[^/]+\.md$/.test(relPath)) return "feature";
  if (/\/entities\/[^/]+\.md$|^entities\/[^/]+\.md$|^derived\/entities\/[^/]+\.md$/.test(relPath)) return "entity";
  if (/\/usecases\/[^/]+\.md$/.test(relPath)) return "usecase";
  if (/\/screens\/[^/]+\.md$/.test(relPath)) return "screen";
  if (/^actors\/[^/]+\.md$/.test(relPath)) return "actor";
  return null;
}

/** 主入口: 对 before/after markdown 算业务级摘要. before=null=create, after=null=delete. */
export function summarizeChange(
  scope: DiffScope | null,
  before: string | null,
  after: string | null,
  idHint: string = "_inline"
): ChangeSummary {
  if (before === null && after !== null) {
    return { line: "新建文件", added: [], removed: [], changed: [], kind: "create" };
  }
  if (after === null) {
    return { line: "删除文件", added: [], removed: [], changed: [], kind: "delete" };
  }
  if (!scope) {
    return textDiffSummary(before ?? "", after);
  }
  switch (scope) {
    case "entity":
      return entityDiff(before ?? "", after, idHint);
    case "feature":
      return featureDiff(before ?? "", after, idHint);
    case "screen":
      return screenDiff(before ?? "", after, idHint);
    case "usecase":
      return usecaseDiff(before ?? "", after, idHint);
    case "actor":
    default:
      return textDiffSummary(before ?? "", after);
  }
}

function entityDiff(before: string, after: string, id: string): ChangeSummary {
  const b = parseEntityMarkdown(id, before, null);
  const a = parseEntityMarkdown(id, after, null);
  const bNames = new Set(b.fields.map((f) => f.name));
  const aNames = new Set(a.fields.map((f) => f.name));
  const added = [...aNames].filter((n) => !bNames.has(n));
  const removed = [...bNames].filter((n) => !aNames.has(n));
  const changed: string[] = [];
  for (const f of a.fields) {
    const old = b.fields.find((x) => x.name === f.name);
    if (!old) continue;
    if (
      old.type !== f.type ||
      old.required !== f.required ||
      (old.constraint || "") !== (f.constraint || "") ||
      (old.notes || "") !== (f.notes || "")
    ) {
      changed.push(f.name);
    }
  }
  return { ...formatLine(added, removed, changed, "字段"), added, removed, changed, kind: "field-diff" };
}

function featureDiff(before: string, after: string, id: string): ChangeSummary {
  const b = parseFeatureMarkdown(id, before);
  const a = parseFeatureMarkdown(id, after);
  const bEnt = new Set(b.entities_touched ?? []);
  const aEnt = new Set(a.entities_touched ?? []);
  const bAct = new Set(b.actor_ids ?? []);
  const aAct = new Set(a.actor_ids ?? []);
  const added = [
    ...[...aEnt].filter((e) => !bEnt.has(e)).map((e) => `entity:${e}`),
    ...[...aAct].filter((e) => !bAct.has(e)).map((e) => `actor:${e}`)
  ];
  const removed = [
    ...[...bEnt].filter((e) => !aEnt.has(e)).map((e) => `entity:${e}`),
    ...[...bAct].filter((e) => !aAct.has(e)).map((e) => `actor:${e}`)
  ];
  const changed: string[] = [];
  if ((b.description || "").trim() !== (a.description || "").trim()) changed.push("描述");
  if ((b.decision_maker_view || "").trim() !== (a.decision_maker_view || "").trim()) changed.push("给决策者");
  if ((b.capability_id || "") !== (a.capability_id || "")) changed.push(`capability:${a.capability_id || "(空)"}`);
  return { ...formatLine(added, removed, changed, "引用"), added, removed, changed, kind: "ref-diff" };
}

function screenDiff(before: string, after: string, id: string): ChangeSummary {
  const b = parseScreen("", id, before);
  const a = parseScreen("", id, after);
  if (!b || !a) return textDiffSummary(before, after);
  const bUc = new Set(b.usecase_ids ?? []);
  const aUc = new Set(a.usecase_ids ?? []);
  const bEnt = new Set(Object.keys(b.entity_visibility ?? {}));
  const aEnt = new Set(Object.keys(a.entity_visibility ?? {}));
  const added = [
    ...[...aUc].filter((u) => !bUc.has(u)).map((u) => `usecase:${u}`),
    ...[...aEnt].filter((e) => !bEnt.has(e)).map((e) => `entity:${e}`)
  ];
  const removed = [
    ...[...bUc].filter((u) => !aUc.has(u)).map((u) => `usecase:${u}`),
    ...[...bEnt].filter((e) => !aEnt.has(e)).map((e) => `entity:${e}`)
  ];
  const changed: string[] = [];
  for (const ent of aEnt) {
    if (!bEnt.has(ent)) continue;
    const bVis = JSON.stringify(b.entity_visibility[ent]);
    const aVis = JSON.stringify(a.entity_visibility[ent]);
    if (bVis !== aVis) changed.push(`entity_visibility:${ent}`);
  }
  if ((b.name || "") !== (a.name || "")) changed.push("name");
  return { ...formatLine(added, removed, changed, "引用"), added, removed, changed, kind: "ref-diff" };
}

function usecaseDiff(before: string, after: string, id: string): ChangeSummary {
  const b = parseUseCase("", id, before);
  const a = parseUseCase("", id, after);
  if (!b || !a) return textDiffSummary(before, after);
  const changed: string[] = [];
  if ((b.precondition || "") !== (a.precondition || "")) changed.push("precondition");
  if ((b.postcondition || "") !== (a.postcondition || "")) changed.push("postcondition");
  if ((b.actor_id || "") !== (a.actor_id || "")) changed.push(`actor:${a.actor_id}`);
  if ((b.function_id || "") !== (a.function_id || "")) changed.push(`function:${a.function_id}`);
  const bBody = (b.body || "").length;
  const aBody = (a.body || "").length;
  if (Math.abs(aBody - bBody) > 30) changed.push(`正文 ${bBody}→${aBody} 字`);
  const bEnt = new Set(b.entity_ids ?? []);
  const aEnt = new Set(a.entity_ids ?? []);
  const added = [...aEnt].filter((e) => !bEnt.has(e)).map((e) => `entity:${e}`);
  const removed = [...bEnt].filter((e) => !aEnt.has(e)).map((e) => `entity:${e}`);
  return { ...formatLine(added, removed, changed, "字段"), added, removed, changed, kind: "ref-diff" };
}

function textDiffSummary(before: string, after: string): ChangeSummary {
  const bLines = before.split("\n").length;
  const aLines = after.split("\n").length;
  const delta = aLines - bLines;
  const sign = delta >= 0 ? "+" : "";
  return {
    line: `正文 ${bLines} → ${aLines} 行 (${sign}${delta})`,
    added: [],
    removed: [],
    changed: [],
    kind: "text-diff"
  };
}

function formatLine(
  added: string[],
  removed: string[],
  changed: string[],
  unit: string
): { line: string } {
  const parts: string[] = [];
  if (added.length > 0) parts.push(`加 ${added.length} ${unit}${joinSample(added)}`);
  if (removed.length > 0) parts.push(`删 ${removed.length}${joinSample(removed)}`);
  if (changed.length > 0) parts.push(`改 ${changed.length}${joinSample(changed)}`);
  if (parts.length === 0) return { line: "无字段级变化" };
  return { line: parts.join(" · ") };
}

function joinSample(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length <= 5) return ` (${items.join(", ")})`;
  return ` (${items.slice(0, 5).join(", ")}... +${items.length - 5})`;
}
