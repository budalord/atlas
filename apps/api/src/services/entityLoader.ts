import type {
  EntitySpec,
  FeaturePoint,
  FeaturePointPreview,
  ModuleColor,
  ModuleGroup,
  ModuleSpec,
  ModuleWithFeatures
} from "@atlas/shared";
import { dataPath, listDirectories, listMarkdownFiles, readTextFile } from "./fileReader";
import { promises as fs } from "node:fs";
import { parseEntityMarkdown } from "./entityParser";
import { parseFeatureMarkdown } from "./featureParser";
import { parseMarkdownWithFrontmatter } from "./markdownParser";

const VALID_COLORS: readonly ModuleColor[] = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "indigo",
  "gray"
];

interface ModuleFrontmatter {
  id?: string;
  name?: string;
  role?: string;
  color?: string;
  order?: number;
  /** 三层架构中层 - 管理模块声明列表 */
  groups?: unknown;
}

/** 容错地把 MODULE.md frontmatter.groups 规整为 ModuleGroup[]。 */
function normalizeGroups(raw: unknown): ModuleGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: ModuleGroup[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as { id?: unknown; name?: unknown; order?: unknown };
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const g: ModuleGroup = { id, name };
    if (typeof r.order === "number") g.order = r.order;
    out.push(g);
  }
  return out;
}

async function pathExists(...segments: string[]): Promise<boolean> {
  try {
    await fs.access(dataPath(...segments));
    return true;
  } catch {
    return false;
  }
}

/**
 * 加载产品下所有实体(顶层 entities/ + modules/<name>/entities/)。
 * 顶层为共享实体(module=null),模块下为该模块实体。
 */
export async function loadEntities(productId: string): Promise<EntitySpec[]> {
  const entities: EntitySpec[] = [];

  // 顶层共享实体
  if (await pathExists("products", productId, "entities")) {
    const files = await listMarkdownFiles("products", productId, "entities");
    for (const file of files) {
      const source = await readTextFile("products", productId, "entities", file);
      if (!source) continue;
      const id = file.replace(/\.md$/, "");
      entities.push(parseEntityMarkdown(id, source, null));
    }
  }

  // 模块下实体
  if (await pathExists("products", productId, "modules")) {
    const modules = await listDirectories("products", productId, "modules");
    for (const mod of modules) {
      if (!(await pathExists("products", productId, "modules", mod, "entities"))) continue;
      const files = await listMarkdownFiles("products", productId, "modules", mod, "entities");
      for (const file of files) {
        const source = await readTextFile("products", productId, "modules", mod, "entities", file);
        if (!source) continue;
        const id = file.replace(/\.md$/, "");
        entities.push(parseEntityMarkdown(id, source, mod));
      }
    }
  }

  return entities;
}

export async function loadEntity(
  productId: string,
  entityId: string
): Promise<EntitySpec | null> {
  // 优先顶层
  const top = await readTextFile("products", productId, "entities", `${entityId}.md`);
  if (top) {
    return parseEntityMarkdown(entityId, top, null);
  }
  // 模块下查找
  if (await pathExists("products", productId, "modules")) {
    const modules = await listDirectories("products", productId, "modules");
    for (const mod of modules) {
      const source = await readTextFile(
        "products",
        productId,
        "modules",
        mod,
        "entities",
        `${entityId}.md`
      );
      if (source) {
        return parseEntityMarkdown(entityId, source, mod);
      }
    }
  }
  return null;
}

export async function loadModules(productId: string): Promise<ModuleSpec[]> {
  if (!(await pathExists("products", productId, "modules"))) {
    return [];
  }
  const dirs = await listDirectories("products", productId, "modules");
  const modules: ModuleSpec[] = [];
  for (const name of dirs) {
    let title = name;
    let description = "";
    let fmId: string | undefined;
    let fmName: string | undefined;
    let fmRole: string | undefined;
    let fmColor: ModuleColor | undefined;
    let fmOrder: number | undefined;
    let fmGroups: ModuleGroup[] = [];

    const moduleMd = await readTextFile("products", productId, "modules", name, "MODULE.md");
    if (moduleMd) {
      const parsed = parseMarkdownWithFrontmatter<ModuleFrontmatter>(moduleMd, {});
      const body = parsed.body;
      title = parsed.frontmatter.name?.trim() || body.match(/^#\s+(.+)$/m)?.[1]?.trim() || name;
      description = extractFirstParagraph(body);
      fmId = parsed.frontmatter.id?.trim() || undefined;
      fmName = parsed.frontmatter.name?.trim() || undefined;
      fmRole = parsed.frontmatter.role?.trim() || undefined;
      const rawColor = parsed.frontmatter.color?.trim();
      if (rawColor && (VALID_COLORS as readonly string[]).includes(rawColor)) {
        fmColor = rawColor as ModuleColor;
      }
      if (typeof parsed.frontmatter.order === "number") {
        fmOrder = parsed.frontmatter.order;
      } else if (typeof parsed.frontmatter.order === "string") {
        const n = Number.parseInt(parsed.frontmatter.order, 10);
        if (!Number.isNaN(n)) fmOrder = n;
      }
      fmGroups = normalizeGroups(parsed.frontmatter.groups);
    }

    let entityCount = 0;
    if (await pathExists("products", productId, "modules", name, "entities")) {
      const files = await listMarkdownFiles("products", productId, "modules", name, "entities");
      entityCount = files.length;
    }
    let featureCount = 0;
    if (await pathExists("products", productId, "modules", name, "features")) {
      const files = await listMarkdownFiles("products", productId, "modules", name, "features");
      featureCount = files.length;
    }
    modules.push({
      name,
      title,
      description,
      entityCount,
      featureCount,
      id: fmId,
      role: fmRole,
      color: fmColor,
      order: fmOrder,
      ...(fmGroups.length > 0 ? { groups: fmGroups } : {})
    });
    // 注意: fmName 已经被用作 title 兜底,这里不再单独存
    void fmName;
  }
  // 按 order 排序(undefined 排后),tie-break 用 id 字母序
  modules.sort((a, b) => {
    const ao = a.order ?? Number.POSITIVE_INFINITY;
    const bo = b.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return (a.id ?? a.name).localeCompare(b.id ?? b.name);
  });
  return modules;
}

/**
 * 加载单个模块下的所有功能点(完整 FeaturePoint),只扫 features/*.md。
 */
export async function loadFeatures(
  productId: string,
  moduleName: string
): Promise<FeaturePoint[]> {
  const dir = ["products", productId, "modules", moduleName, "features"];
  if (!(await pathExists(...dir))) return [];
  const files = await listMarkdownFiles(...dir);
  const features: FeaturePoint[] = [];
  for (const file of files) {
    if (file.endsWith(".draft")) continue;
    const source = await readTextFile(...dir, file);
    if (!source) continue;
    const id = file.replace(/\.md$/, "");
    features.push(parseFeatureMarkdown(id, source));
  }
  return features;
}

export async function loadFeature(
  productId: string,
  featureId: string
): Promise<{ feature: FeaturePoint; moduleName: string } | null> {
  if (!(await pathExists("products", productId, "modules"))) return null;
  const modules = await listDirectories("products", productId, "modules");
  for (const mod of modules) {
    const source = await readTextFile(
      "products",
      productId,
      "modules",
      mod,
      "features",
      `${featureId}.md`
    );
    if (source) {
      return { feature: parseFeatureMarkdown(featureId, source), moduleName: mod };
    }
  }
  return null;
}

/** 给定 feature,返回相对产品目录的源路径。 */
export function featureSourcePath(moduleName: string, featureId: string): string {
  return `modules/${moduleName}/features/${featureId}.md`;
}

/** 给定 feature 文件的绝对路径(包括 .draft 变体辅助)。 */
export function featureFilePath(
  productId: string,
  moduleName: string,
  featureId: string,
  isDraft = false
): string {
  return dataPath(
    "products",
    productId,
    "modules",
    moduleName,
    "features",
    `${featureId}.md${isDraft ? ".draft" : ""}`
  );
}

/**
 * 金字塔视图主数据:每个模块 + 其下功能点的轻量预览(前 100 字描述 + pending 计数)。
 */
export async function loadModulesWithFeatures(
  productId: string
): Promise<ModuleWithFeatures[]> {
  const modules = await loadModules(productId);
  const result: ModuleWithFeatures[] = [];
  for (const mod of modules) {
    const features = await loadFeatures(productId, mod.name);
    const previews: FeaturePointPreview[] = features.map((f) => ({
      id: f.id,
      name: f.name,
      module: mod.name,
      descriptionPreview: f.description.slice(0, 100),
      pendingCount: f.clues.pending.length,
      resolvedCount: f.clues.resolved.length,
      last_refined_at: f.last_refined_at,
      pendingPreview: f.clues.pending.slice(0, 3).map((c) => c.content.slice(0, 80)),
      feedbackCount: f.feedback?.length ?? 0,
      needs_revision: f.needs_revision === true,
      ...(f.roles && f.roles.length > 0 ? { roles: f.roles } : {}),
      ...(f.module_group ? { module_group: f.module_group } : {}),
      ...(f.entities_touched && f.entities_touched.length > 0
        ? { entities_touched: f.entities_touched }
        : {}),
      ...(f.ownership ? { ownership: f.ownership } : {})
    }));
    // 功能点按 id 字母序稳定输出
    previews.sort((a, b) => a.id.localeCompare(b.id));
    result.push({ module: mod, features: previews });
  }
  return result;
}

function stripFrontmatter(source: string): string {
  const match = source.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return match ? match[1] : source;
}

function extractFirstParagraph(body: string): string {
  const afterH1 = body.replace(/^#\s+.+\n/, "");
  const para = afterH1.split(/\n\s*\n/).find((p) => p.trim().length > 0 && !p.trim().startsWith("#"));
  return (para ?? "").trim();
}
