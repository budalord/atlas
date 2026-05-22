import { Router, Request } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  featureFilePath,
  loadFeature,
  loadModules
} from "../services/entityLoader";
import { dataPath, readTextFile } from "../services/fileReader";
import { getDataVersion } from "../services/watcher";
import { parseFeatureMarkdown } from "../services/featureParser";
import { normalizeProductMeta, parseYaml } from "../services/markdownParser";
import { findInvalidRoleIds } from "../services/rolesRegistry";
import { enqueueRefine, readDraft } from "../services/taskQueue";

const FID_RE = /^[a-z][a-z0-9-]*$/;

type FeatureReq = Request<{ id: string; fid: string }>;

export const featuresRouter = Router({ mergeParams: true });

/**
 * POST /api/products/:id/features — body { moduleName, featureId, name }
 * 落盘功能点骨架。根据当前产品 status 推导 added_in_phase:
 *   - planning/discovering: 不写 frontmatter 中的 added_in_phase / added_at
 *   - 其他: 写 added_in_phase + added_at
 */
featuresRouter.post("/", async (req: Request<{ id: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const {
      moduleName,
      featureId,
      name,
      roles,
      module_group: moduleGroupRaw,
      entities_touched: entitiesRaw,
      ownership: ownershipRaw
    } = req.body ?? {};

    if (typeof moduleName !== "string" || moduleName.length === 0) {
      res.status(400).json({ error: "moduleName required" });
      return;
    }
    if (typeof featureId !== "string" || !FID_RE.test(featureId)) {
      res.status(400).json({ error: "featureId must be kebab-case" });
      return;
    }
    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "name required" });
      return;
    }
    const rolesError = await validateRolesInput(roles);
    if (rolesError) {
      res.status(400).json({ error: rolesError });
      return;
    }
    const rolesClean = sanitizeRolesInput(roles);

    const metaSource = await readTextFile("products", productId, "meta.yml");
    if (!metaSource) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const meta = normalizeProductMeta(parseYaml(metaSource));

    const moduleDir = dataPath("products", productId, "modules", moduleName, "features");
    const filePath = path.join(moduleDir, `${featureId}.md`);
    try {
      await fs.access(filePath);
      res.status(409).json({ error: "Feature file already exists" });
      return;
    } catch {
      // not exists, ok
    }
    await fs.mkdir(moduleDir, { recursive: true });

    const today = new Date().toISOString().slice(0, 10);
    const isPlanning = meta.status === "planning" || meta.status === "discovering";
    const frontmatter: Record<string, unknown> = {
      id: featureId,
      name,
      module: moduleName,
      created_at: today
    };
    if (!isPlanning) {
      frontmatter.added_in_phase = meta.status;
      frontmatter.added_at = today;
    }
    if (rolesClean.length > 0) {
      frontmatter.roles = rolesClean;
    }
    if (typeof moduleGroupRaw === "string" && moduleGroupRaw.trim().length > 0) {
      frontmatter.module_group = moduleGroupRaw.trim();
    }
    if (Array.isArray(entitiesRaw)) {
      const clean = entitiesRaw
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (clean.length > 0) frontmatter.entities_touched = clean;
    }
    if (typeof ownershipRaw === "string" && ownershipRaw.trim().length > 0) {
      frontmatter.ownership = ownershipRaw.trim();
    }
    const body = `---\n${YAML.stringify(frontmatter).trim()}\n---\n# ${name}\n\n## 描述\n\n## 线索池\n\n### Pending\n\n### Resolved\n\n## 反馈池\n\n\`\`\`yaml\n[]\n\`\`\`\n`;
    await fs.writeFile(filePath, body, "utf8");

    const parsed = parseFeatureMarkdown(featureId, body);
    res.status(201).json({ data: { feature: parsed, moduleName }, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/products/:id/features/:fid/roles — body { roles: string[] }
 * 替换功能点 frontmatter 的 roles 字段。
 *   - roles 必须是 string[](允许空数组 → 抹掉 roles 字段)
 *   - 所有 id 必须在 data/roles.yml 中存在;否则 400 拒绝
 *   - 仅改写 YAML frontmatter,body 部分原样保留
 */
featuresRouter.patch("/:fid/roles", async (req: FeatureReq, res, next) => {
  try {
    const incoming = req.body?.roles;
    const rolesError = await validateRolesInput(incoming);
    if (rolesError) {
      res.status(400).json({ error: rolesError });
      return;
    }
    const rolesClean = sanitizeRolesInput(incoming);

    const located = await loadFeature(req.params.id, req.params.fid);
    if (!located) {
      res.status(404).json({ error: "Feature not found" });
      return;
    }
    const filePath = featureFilePath(req.params.id, located.moduleName, req.params.fid);
    const source = await fs.readFile(filePath, "utf8");
    const next$ = setFrontmatterRoles(source, rolesClean);
    await fs.writeFile(filePath, next$, "utf8");

    const updated = parseFeatureMarkdown(req.params.fid, next$);
    res.json({ data: updated, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/products/:id/features/:fid/review
 *   body: { action: "mark" | "unmark", by?: string }
 *
 * 决策者审阅戳。mark 写 frontmatter.reviewed_at = today + 可选 reviewed_by;
 * unmark 抹掉两个字段(回到"待审")。
 */
featuresRouter.patch("/:fid/review", async (req: FeatureReq, res, next) => {
  try {
    const action = req.body?.action;
    if (action !== "mark" && action !== "unmark") {
      res.status(400).json({ error: 'action must be "mark" or "unmark"' });
      return;
    }
    const by = typeof req.body?.by === "string" ? req.body.by.trim() : "";

    const located = await loadFeature(req.params.id, req.params.fid);
    if (!located) {
      res.status(404).json({ error: "Feature not found" });
      return;
    }
    const filePath = featureFilePath(req.params.id, located.moduleName, req.params.fid);
    const source = await fs.readFile(filePath, "utf8");
    const today = new Date().toISOString().slice(0, 10);
    const next$ = setFrontmatterReview(source, action === "mark" ? { date: today, by: by || undefined } : null);
    await fs.writeFile(filePath, next$, "utf8");

    const updated = parseFeatureMarkdown(req.params.fid, next$);
    res.json({ data: updated, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/products/:id/features/:fid — 单个功能点完整数据 + 所属模块的 ModuleSpec 字段。
 */
featuresRouter.get("/:fid", async (req: FeatureReq, res, next) => {
  try {
    const result = await loadFeature(req.params.id, req.params.fid);
    if (!result) {
      res.status(404).json({ error: "Feature not found" });
      return;
    }
    // 顺手把所属模块的 frontmatter 信息(color/role/title)带回去,前端用来上色
    const modules = await loadModules(req.params.id);
    const mod = modules.find((m) => m.name === result.moduleName) ?? null;
    res.json({
      data: { feature: result.feature, module: mod },
      version: getDataVersion()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/products/:id/features/:fid/clues — body { content: string }
 * 在 markdown 文件的 ### Pending 标题正下方插入一行 `- (YYYY-MM-DD) content`。
 */
featuresRouter.post("/:fid/clues", async (req: FeatureReq, res, next) => {
  try {
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    if (!content) {
      res.status(400).json({ error: "content required" });
      return;
    }
    const located = await loadFeature(req.params.id, req.params.fid);
    if (!located) {
      res.status(404).json({ error: "Feature not found" });
      return;
    }
    const filePath = featureFilePath(req.params.id, located.moduleName, req.params.fid);
    const source = await fs.readFile(filePath, "utf8");

    const today = new Date().toISOString().slice(0, 10);
    const inserted = insertPendingClue(source, today, content);
    if (inserted === null) {
      res
        .status(409)
        .json({ error: '功能点 markdown 缺少 "### Pending" 段,无法插入线索' });
      return;
    }
    await fs.writeFile(filePath, inserted, "utf8");

    // 返回最新解析结果给前端
    const updated = parseFeatureMarkdown(req.params.fid, inserted);
    res.status(201).json({ data: updated, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/products/:id/features/:fid/refine — 入队一个 codex refine 任务。
 */
featuresRouter.post("/:fid/refine", async (req: FeatureReq, res, next) => {
  try {
    const located = await loadFeature(req.params.id, req.params.fid);
    if (!located) {
      res.status(404).json({ error: "Feature not found" });
      return;
    }
    if (located.feature.clues.pending.length === 0) {
      res.status(400).json({ error: "no pending clues to refine" });
      return;
    }
    const productDir = dataPath("products", req.params.id);
    const task = enqueueRefine({
      productId: req.params.id,
      moduleName: located.moduleName,
      featureId: req.params.fid,
      featureName: located.feature.name,
      productDir
    });
    res.status(202).json({ data: task, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/products/:id/features/:fid — 硬删除功能点 markdown 文件(同时尝试清理 .draft 残留)。
 */
featuresRouter.delete("/:fid", async (req: FeatureReq, res, next) => {
  try {
    const located = await loadFeature(req.params.id, req.params.fid);
    if (!located) {
      res.status(404).json({ error: "Feature not found" });
      return;
    }
    const main = featureFilePath(req.params.id, located.moduleName, req.params.fid);
    await fs.unlink(main);
    const draft = featureFilePath(req.params.id, located.moduleName, req.params.fid, true);
    try {
      await fs.unlink(draft);
    } catch {
      // draft 不存在是正常情况
    }
    res.json({ data: { id: req.params.fid }, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/products/:id/features/:fid/draft — 返回 original + draft 文本。
 */
featuresRouter.get("/:fid/draft", async (req: FeatureReq, res, next) => {
  try {
    const bundle = await readDraft(req.params.id, req.params.fid);
    if (!bundle) {
      res.status(404).json({ error: "Feature not found" });
      return;
    }
    res.json({ data: bundle, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * 在 `### Pending` 标题行的下一空白行后插入新条目。
 * 找不到 Pending 标题返回 null。
 */
export function insertPendingClue(
  source: string,
  date: string,
  content: string
): string | null {
  const headingRe = /^###\s+Pending\s*$/m;
  const headingMatch = source.match(headingRe);
  if (!headingMatch || headingMatch.index === undefined) return null;
  const headingEnd = source.indexOf("\n", headingMatch.index);
  if (headingEnd < 0) return null;
  // 跳过紧随其后的空行(若有);新条目放在第一行非空内容上方
  let insertPos = headingEnd + 1;
  // 跳过紧跟 Pending 标题的纯空行,让新插入项与已有项保持一致的格式
  while (source[insertPos] === "\n") insertPos++;
  const newLine = `- (${date}) ${content}\n`;
  // 如果跳过了空行,需在新行后保留原换行;否则直接拼接
  return source.slice(0, insertPos) + newLine + source.slice(insertPos);
}

/**
 * 校验入参 roles。
 *   - undefined / 空数组 → 视为"清空 roles",合法,返回 null
 *   - 非数组 / 含非字符串 → 返回错误描述
 *   - 数组中任一 id 不在 RolesRegistry 中 → 返回错误描述,列出非法 id
 */
async function validateRolesInput(input: unknown): Promise<string | null> {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input)) return "roles must be an array of role id strings";
  for (const item of input) {
    if (typeof item !== "string") return "roles items must be strings";
  }
  const cleaned = sanitizeRolesInput(input);
  if (cleaned.length === 0) return null;
  const invalid = await findInvalidRoleIds(cleaned);
  if (invalid.length > 0) {
    return `unknown role id(s): ${invalid.join(", ")} (see data/roles.yml)`;
  }
  return null;
}

/** 去空白 / 去空串 / 去重保序。入参不是数组返回空数组。 */
function sanitizeRolesInput(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 写 / 抹 frontmatter 的 reviewed_at + reviewed_by。
 *   - patch !== null:写 reviewed_at=patch.date(必填);patch.by 非空才写 reviewed_by
 *   - patch === null:抹掉 reviewed_at + reviewed_by(回到"待审")
 *   - frontmatter 不存在:仅在 patch !== null 时补一段最小 frontmatter
 */
export function setFrontmatterReview(
  source: string,
  patch: { date: string; by?: string } | null
): string {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    if (!patch) return source;
    const fm: Record<string, unknown> = { reviewed_at: patch.date };
    if (patch.by) fm.reviewed_by = patch.by;
    return `---\n${YAML.stringify(fm).trim()}\n---\n${source}`;
  }
  const fm = (YAML.parse(match[1]) ?? {}) as Record<string, unknown>;
  if (patch) {
    fm.reviewed_at = patch.date;
    if (patch.by) {
      fm.reviewed_by = patch.by;
    } else {
      delete fm.reviewed_by;
    }
  } else {
    delete fm.reviewed_at;
    delete fm.reviewed_by;
  }
  const fmText = Object.keys(fm).length === 0 ? "" : YAML.stringify(fm).trim();
  const body = match[2];
  if (fmText.length === 0) {
    return body.replace(/^\n+/, "");
  }
  return `---\n${fmText}\n---\n${body}`;
}

/**
 * 用新的 roles 数组替换 markdown frontmatter 的 roles 字段。
 *   - 空数组 → 抹掉 roles 字段
 *   - frontmatter 不存在 → 在文件最前加一段 frontmatter
 *   - body 部分原样保留
 */
export function setFrontmatterRoles(source: string, roles: string[]): string {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    // 老文件无 frontmatter:补一段最小 frontmatter
    const fm: Record<string, unknown> = {};
    if (roles.length > 0) fm.roles = roles;
    if (Object.keys(fm).length === 0) return source;
    return `---\n${YAML.stringify(fm).trim()}\n---\n${source}`;
  }
  const fm = (YAML.parse(match[1]) ?? {}) as Record<string, unknown>;
  if (roles.length > 0) {
    fm.roles = roles;
  } else {
    delete fm.roles;
  }
  const fmText = Object.keys(fm).length === 0 ? "" : YAML.stringify(fm).trim();
  const body = match[2];
  if (fmText.length === 0) {
    // 删除 frontmatter 块,body 单独保留
    return body.replace(/^\n+/, "");
  }
  return `---\n${fmText}\n---\n${body}`;
}

