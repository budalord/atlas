import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  DerivedEntitiesData,
  DerivedEntity,
  DerivedEntityQuestionsData,
  EntityQuestion,
  EntityReconcileDiff,
  EntityReconcileReport
} from "@atlas/shared";
import {
  dataPath,
  getFileMtime,
  listMarkdownFiles
} from "./fileReader";
import { parseMarkdownWithFrontmatter, parseYaml } from "./markdownParser";

interface DerivedEntityFrontmatter {
  name?: string;
  layer?: string;
  maintainers?: string;
  sourceFeatures?: unknown;
  sourceSeams?: unknown;
  sourceDecisions?: unknown;
  generated_at?: string;
}

/**
 * 加载 data/products/<id>/derived/entities/*.md(不含 questions.md / reconcile-report.md)。
 */
export async function loadDerivedEntities(productId: string): Promise<DerivedEntity[]> {
  let files: string[];
  try {
    files = await listMarkdownFiles("products", productId, "derived", "entities");
  } catch {
    return [];
  }
  const skip = new Set(["questions.md", "reconcile-report.md"]);
  const entityFiles = files.filter((f) => !skip.has(f));

  const out: DerivedEntity[] = [];
  for (const fname of entityFiles) {
    const filePath = dataPath("products", productId, "derived", "entities", fname);
    try {
      const content = await fs.readFile(filePath, "utf8");
      out.push(parseDerivedEntity(fname.replace(/\.md$/, ""), content));
    } catch {
      // skip unreadable
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function parseDerivedEntity(idFromFile: string, source: string): DerivedEntity {
  const parsed = parseMarkdownWithFrontmatter<DerivedEntityFrontmatter>(source, {});
  const fm = parsed.frontmatter;
  return {
    name: fm.name?.trim() || idFromFile,
    layer: fm.layer?.trim() || "[TBD]",
    maintainers: fm.maintainers?.trim() || "[TBD]",
    sourceFeatures: stringArray(fm.sourceFeatures),
    sourceSeams: stringArray(fm.sourceSeams),
    sourceDecisions: stringArray(fm.sourceDecisions),
    generated_at: fm.generated_at?.trim() || null,
    body: parsed.body.trim()
  };
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
}

/**
 * 计算派生整体 stale 状态。
 * stale = derived/entities/ 任一实体文件 mtime < (任一 features/*.md / SEAMS.md / DECISIONS.md /
 * ENTITIES-OWNERSHIP.md 的最新 mtime)。
 *
 * 派生不存在 → stale=false(空状态由 UI 引导);
 */
export async function computeDerivedEntitiesStale(productId: string): Promise<{
  derivedNewestMtime: number | null;
  stale: boolean;
  stale_reason: string | null;
}> {
  const dir = dataPath("products", productId, "derived", "entities");
  let entityFiles: string[];
  try {
    entityFiles = (await listMarkdownFiles("products", productId, "derived", "entities")).filter(
      (f) => f !== "questions.md" && f !== "reconcile-report.md"
    );
  } catch {
    return { derivedNewestMtime: null, stale: false, stale_reason: null };
  }
  if (entityFiles.length === 0) {
    return { derivedNewestMtime: null, stale: false, stale_reason: null };
  }

  let derivedOldest: { file: string; mtime: number } | null = null;
  for (const f of entityFiles) {
    const mtime = await safeMtimeMs(path.join(dir, f));
    if (mtime === null) continue;
    if (!derivedOldest || mtime < derivedOldest.mtime) derivedOldest = { file: f, mtime };
  }
  if (!derivedOldest) {
    return { derivedNewestMtime: null, stale: false, stale_reason: null };
  }

  // 收集 source 文件最新 mtime
  const candidates: Array<{ label: string; absPath: string }> = [];
  try {
    const moduleEntries = await fs.readdir(dataPath("products", productId, "modules"), { withFileTypes: true });
    for (const mod of moduleEntries) {
      if (!mod.isDirectory()) continue;
      try {
        const featureFiles = await listMarkdownFiles(
          "products",
          productId,
          "modules",
          mod.name,
          "features"
        );
        for (const ff of featureFiles) {
          candidates.push({
            label: `${mod.name}/${ff.replace(/\.md$/, "")}`,
            absPath: dataPath("products", productId, "modules", mod.name, "features", ff)
          });
        }
      } catch {
        // skip
      }
    }
  } catch {
    // no modules dir
  }
  for (const fname of ["SEAMS.md", "DECISIONS.md", "ENTITIES-OWNERSHIP.md"]) {
    candidates.push({ label: fname, absPath: dataPath("products", productId, fname) });
  }

  let newestSource: { label: string; mtime: number } | null = null;
  for (const c of candidates) {
    const m = await safeMtimeMs(c.absPath);
    if (m === null) continue;
    if (!newestSource || m > newestSource.mtime) newestSource = { label: c.label, mtime: m };
  }
  if (!newestSource) {
    return { derivedNewestMtime: derivedOldest.mtime, stale: false, stale_reason: null };
  }
  if (newestSource.mtime <= derivedOldest.mtime) {
    return { derivedNewestMtime: derivedOldest.mtime, stale: false, stale_reason: null };
  }
  const newestIso = new Date(newestSource.mtime).toISOString();
  const derivedIso = new Date(derivedOldest.mtime).toISOString();
  return {
    derivedNewestMtime: derivedOldest.mtime,
    stale: true,
    stale_reason: `${newestSource.label} 修改于 ${newestIso} 晚于派生(${derivedOldest.file} @ ${derivedIso})`
  };
}

/**
 * 加载派生整体数据(实体清单 + stale 状态)。
 */
export async function loadDerivedEntitiesData(productId: string): Promise<DerivedEntitiesData> {
  const entities = await loadDerivedEntities(productId);
  const { stale, stale_reason, derivedNewestMtime } = await computeDerivedEntitiesStale(productId);
  return {
    exists: entities.length > 0,
    entities,
    generated_at: derivedNewestMtime ? new Date(derivedNewestMtime).toISOString() : null,
    stale,
    stale_reason
  };
}

async function safeMtimeMs(absPath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(absPath);
    return stat.mtime.getTime();
  } catch {
    return null;
  }
}

/* ============================================================
 *  reconcile-report.md 加载 + 解析
 * ============================================================ */

/**
 * 加载并解析 derived/entities/reconcile-report.md。
 * 文件不存在 → exists=false, 三段都是空数组。
 */
export async function loadEntityReconcileReport(productId: string): Promise<EntityReconcileReport> {
  const filePath = dataPath("products", productId, "derived", "entities", "reconcile-report.md");
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        exists: false,
        rawMarkdown: "",
        derivedOnly: [],
        declaredOnly: [],
        layerMismatch: [],
        last_modified: null
      };
    }
    throw e;
  }
  const last_modified = await getFileMtime("products", productId, "derived", "entities", "reconcile-report.md");

  return {
    exists: true,
    rawMarkdown: raw,
    derivedOnly: parseTableUnder(raw, "派生有声明无", ["实体", "派生依据", "建议"], (cells) => ({
      name: cells[0] ?? "",
      derivedNote: cells[1] ?? "",
      suggestion: cells[2] ?? ""
    })),
    declaredOnly: parseTableUnder(raw, "声明有派生无", ["实体", "表声明 layer", "可能原因"], (cells) => ({
      name: cells[0] ?? "",
      declaredLayer: cells[1] ?? "",
      suggestion: cells[2] ?? ""
    })),
    layerMismatch: parseTableUnder(raw, "归属不一致", ["实体", "表声明", "派生推断", "建议"], (cells) => ({
      name: cells[0] ?? "",
      declaredLayer: cells[1] ?? "",
      derivedLayer: cells[2] ?? "",
      suggestion: cells[3] ?? ""
    })),
    last_modified
  };
}

/**
 * 从 markdown 中提取指定 H2 段下面的第一张 markdown 表格,解析行。
 * H2 的精确匹配是 "## <heading 子串>",取后续直到下一个 H2 或文末。
 */
function parseTableUnder(
  markdown: string,
  headingFragment: string,
  _expectedColumns: string[],
  toDiff: (cells: string[]) => EntityReconcileDiff
): EntityReconcileDiff[] {
  const re = new RegExp(`##\\s+[^\\n]*${escapeRe(headingFragment)}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s+|$(?![\\r\\n\\s\\S]))`, "m");
  const m = markdown.match(re);
  if (!m) return [];
  const section = m[1];
  const out: EntityReconcileDiff[] = [];
  const lines = section.split("\n");
  let headerSeen = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    const cells = line.slice(1, -1).split("|").map((c) => c.trim());
    if (cells.every((c) => /^[-:]+$/.test(c))) continue;
    if (!headerSeen) {
      headerSeen = true;
      continue;
    }
    if ((cells[0] ?? "").length === 0) continue;
    out.push(toDiff(cells));
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ============================================================
 *  questions.md 加载 + 解析(对偶 flowcharts 模式)
 * ============================================================ */

/**
 * 加载并 lint derived/entities/questions.md。
 */
export async function loadEntityQuestions(productId: string): Promise<DerivedEntityQuestionsData> {
  const filePath = dataPath("products", productId, "derived", "entities", "questions.md");
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, questions: [], questions_lint_ok: true, questions_lint_errors: [] };
    }
    throw e;
  }

  const yamlText = extractYamlBlock(content);
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (e) {
    return {
      exists: true,
      questions: [],
      questions_lint_ok: false,
      questions_lint_errors: [`questions.md 不是合法 YAML: ${e instanceof Error ? e.message : String(e)}`]
    };
  }
  if (raw === null || raw === undefined) {
    return { exists: true, questions: [], questions_lint_ok: true, questions_lint_errors: [] };
  }
  if (!Array.isArray(raw)) {
    return {
      exists: true,
      questions: [],
      questions_lint_ok: false,
      questions_lint_errors: ["questions.md 顶层必须是数组(YAML list)"]
    };
  }

  const questions: EntityQuestion[] = [];
  const errors: string[] = [];
  raw.forEach((item, idx) => {
    const out = normalizeQuestion(item, idx);
    if ("question" in out) questions.push(out);
    else errors.push(out.error);
  });

  // trigger lint(同 flowchart §6.3.4):trigger.original_text 必须在 feature_path 中字面命中
  const lintErrors = await lintTriggers(productId, questions);
  const all = [...errors, ...lintErrors];

  return {
    exists: true,
    questions,
    questions_lint_ok: all.length === 0,
    questions_lint_errors: all
  };
}

function extractYamlBlock(content: string): string {
  const fence = content.match(/```ya?ml\n([\s\S]*?)\n```/);
  if (fence) return fence[1];
  return content;
}

function normalizeQuestion(item: unknown, idx: number): EntityQuestion | { error: string } {
  if (!item || typeof item !== "object") return { error: `第 ${idx + 1} 项不是对象` };
  const it = item as Record<string, unknown>;
  const feature = typeof it.feature === "string" ? it.feature : "";
  const mod = typeof it.module === "string" ? it.module : "";
  const question = typeof it.question === "string" ? it.question : "";
  const trigger = it.trigger as { feature_path?: unknown; original_text?: unknown } | undefined;
  const fp = trigger && typeof trigger.feature_path === "string" ? trigger.feature_path : "";
  const ot = trigger && typeof trigger.original_text === "string" ? trigger.original_text : "";
  const proposed = typeof it.proposed_resolution === "string" ? it.proposed_resolution : undefined;
  if (!feature || !mod || !question || !fp || !ot) {
    return { error: `第 ${idx + 1} 项缺字段(需要 feature / module / question / trigger.feature_path / trigger.original_text)` };
  }
  const out: EntityQuestion = {
    feature,
    module: mod,
    question,
    trigger: { feature_path: fp, original_text: ot }
  };
  if (proposed !== undefined) out.proposed_resolution = proposed;
  return out;
}

async function lintTriggers(productId: string, questions: EntityQuestion[]): Promise<string[]> {
  const errors: string[] = [];
  for (const q of questions) {
    const fp = q.trigger.feature_path;
    // entity-contract §5.1: trigger.feature_path 可指向 features / SEAMS / DECISIONS / ENTITIES-OWNERSHIP
    if (
      !fp.startsWith(`data/products/${productId}/`) ||
      !/(\/features\/[^/]+\.md|SEAMS\.md|DECISIONS\.md|ENTITIES-OWNERSHIP\.md)$/.test(fp)
    ) {
      errors.push(
        `feature: ${q.feature} — trigger.feature_path 必须指向 features/<f>.md / SEAMS.md / DECISIONS.md / ENTITIES-OWNERSHIP.md,实际: ${fp}`
      );
      continue;
    }
    const repoRoot = path.resolve(dataPath(".."), "..");
    const abs = path.resolve(repoRoot, fp);
    let content: string;
    try {
      content = await fs.readFile(abs, "utf8");
    } catch {
      errors.push(`feature: ${q.feature} — trigger.feature_path 文件不存在: ${fp}`);
      continue;
    }
    if (!content.includes(q.trigger.original_text)) {
      const preview = q.trigger.original_text.length > 60
        ? q.trigger.original_text.slice(0, 60) + "..."
        : q.trigger.original_text;
      errors.push(`feature: ${q.feature} — trigger.original_text 在 ${fp} 中 grep 不到("${preview}")`);
    }
  }
  return errors;
}
