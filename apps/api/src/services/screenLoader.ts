import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Screen, ScreenEntityVisibility, ScreenValidationIssue } from "@atlas/shared";
import {
  dataPath,
  listDirectories,
  listMarkdownFiles,
  pathExists,
  readTextFile
} from "./fileReader";
import { parseMarkdownWithFrontmatter } from "./markdownParser";
import { parseFeedbackSection } from "./feedbackParser";
import { loadUseCases } from "./usecaseLoader";
import { loadActors } from "./actorLoader";
import { loadModules, loadFeatures } from "./entityLoader";
import { loadDerivedEntities } from "./derivedEntityLoader";
import { parseEntityFieldTable } from "./entityFieldTableParser";

/**
 * Screen loader · 界面屏 (`modules/<m>/screens/<screen-id>.md`)。
 *
 * 见 docs/screen-contract.md (v0.1)。
 * 跨所有 module 扫描 screens/ 子目录, 与 features/ / usecases/ 同级。
 * **不缓存** (规则 5)。
 */

interface ScreenFrontmatter {
  id?: unknown;
  name?: unknown;
  module?: unknown;
  group_id?: unknown;
  usecase_ids?: unknown;
  entity_visibility?: unknown;
  prototype_url?: unknown;
  preview_image?: unknown;
  added_in_phase?: unknown;
  added_at?: unknown;
  needs_revision?: unknown;
  needs_prototype?: unknown;
  pending_prototype?: unknown;
}

const VALID_ADDED_PHASES = new Set(["planning", "in-progress", "live"]);

export async function loadScreens(productId: string): Promise<Screen[]> {
  if (!(await pathExists("products", productId, "modules"))) return [];
  let modules: string[];
  try {
    modules = await listDirectories("products", productId, "modules");
  } catch {
    return [];
  }
  const out: Screen[] = [];
  for (const mod of modules) {
    if (!(await pathExists("products", productId, "modules", mod, "screens"))) continue;
    let files: string[];
    try {
      files = await listMarkdownFiles("products", productId, "modules", mod, "screens");
    } catch {
      continue;
    }
    for (const fname of files) {
      const source = await readTextFile(
        "products",
        productId,
        "modules",
        mod,
        "screens",
        fname
      );
      if (!source) continue;
      const screen = parseScreen(mod, fname.replace(/\.md$/, ""), source);
      if (screen) out.push(screen);
    }
  }
  // 按 module / id 排序, 保持稳定
  out.sort((a, b) => a.module.localeCompare(b.module) || a.id.localeCompare(b.id));
  return out;
}

export async function loadScreen(
  productId: string,
  moduleName: string,
  screenId: string
): Promise<Screen | null> {
  const source = await readTextFile(
    "products",
    productId,
    "modules",
    moduleName,
    "screens",
    `${screenId}.md`
  );
  if (source === null) return null;
  return parseScreen(moduleName, screenId, source);
}

/** 反向聚合: 找承接某 usecase 的所有 screens (loader 无索引, 全扫)。 */
export async function loadScreensForUseCase(
  productId: string,
  usecaseId: string
): Promise<Screen[]> {
  const all = await loadScreens(productId);
  return all.filter((s) => s.usecase_ids.includes(usecaseId));
}

/** 反向聚合: 找在 entity_visibility 中露出某 entity 的所有 screens。 */
export async function loadScreensForEntity(
  productId: string,
  entityName: string
): Promise<Screen[]> {
  const all = await loadScreens(productId);
  return all.filter((s) => Object.prototype.hasOwnProperty.call(s.entity_visibility, entityName));
}

export function parseScreen(
  moduleName: string,
  idFromFile: string,
  source: string
): Screen | null {
  const parsed = parseMarkdownWithFrontmatter<ScreenFrontmatter>(source, {});
  const fm = parsed.frontmatter;

  const id = typeof fm.id === "string" && fm.id.trim().length > 0 ? fm.id.trim() : idFromFile;
  const name = typeof fm.name === "string" && fm.name.trim().length > 0
    ? fm.name.trim()
    : parsed.body.match(/^#\s+(.+)$/m)?.[1]?.trim() || id;
  const module = typeof fm.module === "string" && fm.module.trim().length > 0
    ? fm.module.trim()
    : moduleName;
  const group_id = typeof fm.group_id === "string" && fm.group_id.trim().length > 0
    ? fm.group_id.trim()
    : undefined;

  const usecase_ids_raw = fm.usecase_ids;
  const usecase_ids = Array.isArray(usecase_ids_raw)
    ? usecase_ids_raw.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter((x) => x.length > 0)
    : [];
  if (usecase_ids.length === 0) return null; // 必填, 缺失视为损坏

  const entity_visibility = normalizeEntityVisibility(fm.entity_visibility);

  const prototype_url = typeof fm.prototype_url === "string" && fm.prototype_url.trim().length > 0
    ? fm.prototype_url.trim()
    : undefined;
  const preview_image = typeof fm.preview_image === "string" && fm.preview_image.trim().length > 0
    ? fm.preview_image.trim()
    : undefined;
  const pending_prototype = typeof fm.pending_prototype === "string" && fm.pending_prototype.trim().length > 0
    ? fm.pending_prototype.trim()
    : undefined;

  const addedPhaseRaw = typeof fm.added_in_phase === "string" ? fm.added_in_phase.trim() : "";
  const added_in_phase = addedPhaseRaw && VALID_ADDED_PHASES.has(addedPhaseRaw)
    ? (addedPhaseRaw as Screen["added_in_phase"])
    : undefined;
  const added_at = typeof fm.added_at === "string" && fm.added_at.trim().length > 0
    ? fm.added_at.trim()
    : undefined;

  const needs_revision = fm.needs_revision === true;
  const needs_prototype = fm.needs_prototype === true;
  const body = parsed.body.trim();
  const feedback = parseFeedbackSection(body);

  return {
    id,
    name,
    module,
    ...(group_id ? { group_id } : {}),
    usecase_ids,
    entity_visibility,
    ...(prototype_url ? { prototype_url } : {}),
    ...(preview_image ? { preview_image } : {}),
    ...(pending_prototype ? { pending_prototype } : {}),
    ...(added_in_phase ? { added_in_phase } : {}),
    ...(added_at ? { added_at } : {}),
    ...(needs_revision ? { needs_revision } : {}),
    ...(needs_prototype ? { needs_prototype } : {}),
    ...(feedback.length > 0 ? { feedback } : {}),
    body
  };
}

function normalizeEntityVisibility(raw: unknown): Record<string, ScreenEntityVisibility> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, ScreenEntityVisibility> = {};
  for (const [entityName, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const v = value as Record<string, unknown>;
    const def = Array.isArray(v.default)
      ? v.default.filter((x): x is string => typeof x === "string")
      : [];
    const role_gated_raw = v.role_gated;
    let role_gated: Record<string, string[]> | undefined;
    if (role_gated_raw && typeof role_gated_raw === "object" && !Array.isArray(role_gated_raw)) {
      role_gated = {};
      for (const [role, fields] of Object.entries(role_gated_raw as Record<string, unknown>)) {
        if (Array.isArray(fields)) {
          role_gated[role] = fields.filter((x): x is string => typeof x === "string");
        }
      }
      if (Object.keys(role_gated).length === 0) role_gated = undefined;
    }
    const derived_fields = Array.isArray(v.derived_fields)
      ? v.derived_fields.filter((x): x is string => typeof x === "string")
      : undefined;
    out[entityName] = {
      default: def,
      ...(role_gated ? { role_gated } : {}),
      ...(derived_fields && derived_fields.length > 0 ? { derived_fields } : {})
    };
  }
  return out;
}

export function screenFilePath(productId: string, moduleName: string, screenId: string): string {
  return dataPath("products", productId, "modules", moduleName, "screens", `${screenId}.md`);
}

export async function writeScreen(productId: string, screen: Screen): Promise<void> {
  const fmObj: Record<string, unknown> = {
    id: screen.id,
    name: screen.name,
    module: screen.module,
    ...(screen.group_id ? { group_id: screen.group_id } : {}),
    usecase_ids: screen.usecase_ids,
    entity_visibility: serializeEntityVisibility(screen.entity_visibility)
  };
  if (screen.prototype_url) fmObj.prototype_url = screen.prototype_url;
  if (screen.preview_image) fmObj.preview_image = screen.preview_image;
  if (screen.pending_prototype) fmObj.pending_prototype = screen.pending_prototype;
  if (screen.added_in_phase) fmObj.added_in_phase = screen.added_in_phase;
  if (screen.added_at) fmObj.added_at = screen.added_at;
  if (screen.needs_revision) fmObj.needs_revision = true;
  if (screen.needs_prototype) fmObj.needs_prototype = true;
  const fmText = YAML.stringify(fmObj).trim();
  const body = screen.body.trim();
  const content = `---\n${fmText}\n---\n\n${body}\n`;
  const dir = path.dirname(screenFilePath(productId, screen.module, screen.id));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(screenFilePath(productId, screen.module, screen.id), content, "utf8");
}

function serializeEntityVisibility(
  ev: Record<string, ScreenEntityVisibility>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [entityName, v] of Object.entries(ev)) {
    const entry: Record<string, unknown> = { default: v.default };
    if (v.role_gated && Object.keys(v.role_gated).length > 0) entry.role_gated = v.role_gated;
    if (v.derived_fields && v.derived_fields.length > 0) entry.derived_fields = v.derived_fields;
    out[entityName] = entry;
  }
  return out;
}

export async function deleteScreen(
  productId: string,
  moduleName: string,
  screenId: string
): Promise<boolean> {
  const filePath = screenFilePath(productId, moduleName, screenId);
  try {
    await fs.unlink(filePath);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

/**
 * 校验 Screen 的引用完整性。 阻断级 issue 由 routes 转 400, 不阻断 loader 加载。
 *
 * 检查项:
 *   1. usecase_ids 全部存在(error)
 *   2. entity_visibility 引用的 entity 名存在(error)
 *   3. 该 entity 被 usecase_ids 中至少一个 usecase 引用(error)
 *   4. entity_visibility 露出的字段必须存在于 entity 字段表(error)
 *      — default / role_gated.*  字段 必须为非派生字段
 *      — derived_fields 子键中的字段 必须在 entity 字段表中标了 derived
 */
export async function validateScreen(
  productId: string,
  screen: Screen
): Promise<ScreenValidationIssue[]> {
  const issues: ScreenValidationIssue[] = [];
  const [allUseCases, allEntities, allActors] = await Promise.all([
    loadUseCases(productId),
    loadDerivedEntities(productId),
    loadActors(productId)
  ]);
  const actorIds = new Set(allActors.map((a) => a.id));

  // 1. usecase_ids 存在性
  const ucIndex = new Map(allUseCases.map((u) => [u.id, u] as const));
  const myUseCases = [];
  for (const uid of screen.usecase_ids) {
    const uc = ucIndex.get(uid);
    if (!uc) {
      issues.push({
        level: "error",
        screenId: screen.id,
        module: screen.module,
        rule: "usecase-not-found",
        detail: `usecase_ids 引用了不存在的 usecase: ${uid}`
      });
    } else {
      myUseCases.push(uc);
    }
  }

  // 1b. group_id: 若所属 module 声明了 groups, 必须 ∈ groups[].id(照搬"字段名锁死")。
  //     格式非法 / 不在声明内 → 阻断; module 有 groups 但 screen 未挂 → 警告(归兜底未分组)。
  if (screen.group_id !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(screen.group_id)) {
    issues.push({
      level: "error",
      screenId: screen.id,
      module: screen.module,
      rule: "group-id-not-in-module",
      detail: `group_id \`${screen.group_id}\` 不是合法 kebab-case`
    });
  }
  if (screen.module !== "shared") {
    try {
      const mods = await loadModules(productId);
      const myMod = mods.find((m) => m.name === screen.module || m.id === screen.module);
      const declared = myMod?.groups ?? [];
      if (declared.length > 0) {
        if (screen.group_id === undefined) {
          issues.push({
            level: "warning",
            screenId: screen.id,
            module: screen.module,
            rule: "group-id-missing",
            detail: `module ${screen.module} 声明了 groups, 但本 screen 未挂 group_id(导航将归入兜底未分组)`
          });
        } else if (!declared.some((g) => g.id === screen.group_id)) {
          issues.push({
            level: "error",
            screenId: screen.id,
            module: screen.module,
            rule: "group-id-not-in-module",
            detail: `group_id \`${screen.group_id}\` 不在 module ${screen.module} 的 MODULE.md groups 内: [${declared.map((g) => g.id).join(", ")}]`
          });
        }
      }
    } catch {
      /* modules 加载失败 — 跳过 group 校验, 不阻断 */
    }
  }

  // 2/3. entity_visibility entity 必须存在 + 必须被某个 usecase 引用
  const entityIndex = new Map(allEntities.map((e) => [e.name, e] as const));

  // usecase.entity_ids 为空时按 usecase-contract 继承 function.entities_touched —
  // 加载全部 function 的 entities_touched 备查(加载失败不阻断, 退回原行为)。
  const fnEntitiesTouched = new Map<string, string[]>();
  try {
    const modules = await loadModules(productId);
    for (const mod of modules) {
      const features = await loadFeatures(productId, mod.name);
      for (const f of features) {
        if (f.entities_touched && f.entities_touched.length > 0) {
          fnEntitiesTouched.set(f.id, f.entities_touched);
        }
      }
    }
  } catch {
    /* features 加载失败 — 退回仅用 entity_ids */
  }

  const entitiesReachableFromUseCases = new Set<string>();
  for (const uc of myUseCases) {
    const eids =
      uc.entity_ids && uc.entity_ids.length > 0
        ? uc.entity_ids
        : fnEntitiesTouched.get(uc.function_id) ?? [];
    for (const eid of eids) entitiesReachableFromUseCases.add(eid);
  }

  for (const [entityName, vis] of Object.entries(screen.entity_visibility)) {
    const entity = entityIndex.get(entityName);
    if (!entity) {
      issues.push({
        level: "error",
        screenId: screen.id,
        module: screen.module,
        rule: "entity-not-referenced-by-usecase",
        detail: `entity_visibility 引用了不存在的 entity: ${entityName}`
      });
      continue;
    }
    if (!entitiesReachableFromUseCases.has(entityName)) {
      issues.push({
        level: "error",
        screenId: screen.id,
        module: screen.module,
        rule: "entity-not-referenced-by-usecase",
        detail: `entity ${entityName} 未被本 screen 的 usecase_ids 中任何 usecase.entity_ids 引用`
      });
    }
    // 4. 字段存在性
    const fieldTable = parseEntityFieldTable(entity.body);
    if (fieldTable.fieldNames.size === 0) {
      // entity 字段表为空 — 跳过字段校验, 但不视为错(可能是 stub entity)
      continue;
    }
    checkFieldList(issues, screen, entityName, "default", vis.default, fieldTable, false);
    if (vis.role_gated) {
      for (const [role, list] of Object.entries(vis.role_gated)) {
        if (!actorIds.has(role)) {
          issues.push({
            level: "error",
            screenId: screen.id,
            module: screen.module,
            rule: "field-not-in-entity-fields-table",
            detail: `role_gated 的 key \`${role}\` 不是 actors/ 中存在的 actor id(entity: ${entityName})`
          });
        }
        checkFieldList(issues, screen, entityName, `role_gated.${role}`, list, fieldTable, false);
      }
    }
    if (vis.derived_fields) {
      checkFieldList(
        issues,
        screen,
        entityName,
        "derived_fields",
        vis.derived_fields,
        fieldTable,
        true
      );
    }
  }

  return issues;
}

function checkFieldList(
  issues: ScreenValidationIssue[],
  screen: Screen,
  entityName: string,
  context: string,
  fields: string[],
  fieldTable: ReturnType<typeof parseEntityFieldTable>,
  expectDerived: boolean
): void {
  for (const f of fields) {
    if (!fieldTable.fieldNames.has(f)) {
      issues.push({
        level: "error",
        screenId: screen.id,
        module: screen.module,
        rule: "field-not-in-entity-fields-table",
        detail: `entity_visibility.${entityName}.${context} 字段 \`${f}\` 不在 ${entityName} 的字段表`
      });
      continue;
    }
    if (expectDerived && !fieldTable.derivedFieldNames.has(f)) {
      issues.push({
        level: "warning",
        screenId: screen.id,
        module: screen.module,
        rule: "field-not-in-entity-fields-table",
        detail: `${entityName}.${f} 列在 derived_fields 但 entity 字段表未标记为 derived(可能挂错位置)`
      });
    }
  }
}

/**
 * 找孤儿 screen — 视图级提示, 不阻断。
 * 孤儿定义: 无任何 usecase 引用 — Screen 自身的 usecase_ids 是真源, 因此孤儿 = usecase_ids 空(已被 parseScreen 视为损坏返回 null)。
 * 这里返回更严的: "其 usecase_ids 全部不存在的 screen"。
 */
export async function findOrphanScreens(productId: string): Promise<ScreenValidationIssue[]> {
  const issues: ScreenValidationIssue[] = [];
  const [screens, usecases] = await Promise.all([loadScreens(productId), loadUseCases(productId)]);
  const ucIds = new Set(usecases.map((u) => u.id));
  for (const s of screens) {
    if (s.usecase_ids.every((uid) => !ucIds.has(uid))) {
      issues.push({
        level: "warning",
        screenId: s.id,
        module: s.module,
        rule: "orphan-screen",
        detail: `screen 的 usecase_ids 全部找不到对应 usecase`
      });
    }
  }
  return issues;
}
