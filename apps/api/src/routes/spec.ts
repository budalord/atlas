import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import type {
  ArchitecturalWarning,
  ArchitecturalWarningsData,
  Decision,
  DecisionStatus,
  EntitiesOwnershipData,
  L0ViolationsData,
  OwnershipEntityRow,
  OwnershipRow,
  ProductVision,
  Seam,
  SpecFile,
  SpecFileKind,
  WarningStatus
} from "@atlas/shared";
import {
  nextDecisionId,
  parseDecisionsMarkdown,
  renderDecisionBlock
} from "../services/decisionParser";
import {
  findEntityRowIndex,
  parseEntitiesOwnership,
  renderEntitiesOwnership
} from "../services/entitiesOwnershipParser";
import {
  loadDerivedEntitiesData,
  loadEntityQuestions,
  loadEntityReconcileReport
} from "../services/derivedEntityLoader";
import { runL0Lint } from "../services/l0Linter";
import { parseSeamsMarkdown } from "../services/seamParser";
import {
  nextWarningId,
  parseWarningsMarkdown,
  renderWarningsMarkdown
} from "../services/warningsParser";
import { dataPath, getFileMtime, readTextFile } from "../services/fileReader";
import { getDataVersion, bumpDataVersion } from "../services/watcher";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../../");

/**
 * 全局规格 router:挂在 /api/spec,返回 ATLAS-SPEC.md 等仓库级文档。
 */
export const specRouter = Router();

specRouter.get("/atlas", async (_req, res, next) => {
  try {
    const buf = await fs.readFile(path.join(repoRoot, "ATLAS-SPEC.md"), "utf8");
    res.type("text/plain; charset=utf-8").send(buf);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      res.status(404).json({ error: "ATLAS-SPEC.md not found at repo root" });
      return;
    }
    next(error);
  }
});

/**
 * 产品规格层(Layer 2)的 7 类标准文件清单。
 * 与设计提案 §3.2 对应 + ATLAS-SPEC.md §"产品规格层文件"。
 *
 * 顺序固定:UI 子页签按 [决策与警告][跨模块契约][演进与风险] 取用 —
 *   - 决策与警告: decisions + architectural-warnings
 *   - 跨模块契约: seams + entities-ownership
 *   - 演进与风险: evolution-principles + ai-requirements + risks
 */
export const SPEC_FILE_REGISTRY: Array<{ kind: SpecFileKind; filename: string }> = [
  { kind: "decisions", filename: "DECISIONS.md" },
  { kind: "architectural-warnings", filename: "ARCHITECTURAL-WARNINGS.md" },
  { kind: "seams", filename: "SEAMS.md" },
  { kind: "entities-ownership", filename: "ENTITIES-OWNERSHIP.md" },
  { kind: "evolution-principles", filename: "EVOLUTION-PRINCIPLES.md" },
  { kind: "ai-requirements", filename: "AI-REQUIREMENTS.md" },
  { kind: "risks", filename: "RISKS.md" }
];

/**
 * 产品级规格 router:挂在 /api/products/:id,提供 7 类标准文件读取。
 *
 * GET /spec-files
 *   → 返回 7 类文件的状态(exists/content/last_modified)。
 *   文件缺失时 exists=false, content="" — UI 显示空态而非 404。
 */
export const productSpecRouter = Router({ mergeParams: true });

/**
 * GET /vision
 *   → 返回 VISION.md(产品愿景,Layer 1)的完整内容。
 *   文件缺失时 exists=false, content="" — UI 在概览 tab 显示空态。
 */
productSpecRouter.get("/vision", async (req, res, next) => {
  const productId = (req.params as { id?: string }).id;
  if (!productId) {
    res.status(400).json({ error: "missing product id" });
    return;
  }
  try {
    const productDir = dataPath("products", productId);
    try {
      await fs.access(productDir);
    } catch {
      res.status(404).json({ error: `product not found: ${productId}` });
      return;
    }
    const content = await readTextFile("products", productId, "VISION.md");
    const last_modified = content === null ? null : await getFileMtime("products", productId, "VISION.md");
    const data: ProductVision = {
      exists: content !== null,
      content: content ?? "",
      last_modified
    };
    res.json({ data, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /decisions
 *   → 返回结构化决策列表(从 DECISIONS.md 解析)。
 *   文件缺失或空 → exists=false, decisions=[]
 */
productSpecRouter.get("/decisions", async (req, res, next) => {
  const productId = (req.params as { id?: string }).id;
  if (!productId) {
    res.status(400).json({ error: "missing product id" });
    return;
  }
  try {
    if (!(await productExists(productId))) {
      res.status(404).json({ error: `product not found: ${productId}` });
      return;
    }
    const content = await readTextFile("products", productId, "DECISIONS.md");
    const decisions: Decision[] = content === null ? [] : parseDecisionsMarkdown(content);
    const last_modified = content === null ? null : await getFileMtime("products", productId, "DECISIONS.md");
    res.json({
      data: { exists: content !== null, decisions, last_modified },
      version: getDataVersion()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /decisions
 *   body: { title, summary?, affectedFeatures?, sourceRef?, body? }
 *   → 自动算 D-N+1,追加到 DECISIONS.md 末尾(若无文件则新建 + 加 H1 头)。
 */
productSpecRouter.post("/decisions", async (req, res, next) => {
  const productId = (req.params as { id?: string }).id;
  if (!productId) {
    res.status(400).json({ error: "missing product id" });
    return;
  }
  try {
    if (!(await productExists(productId))) {
      res.status(404).json({ error: `product not found: ${productId}` });
      return;
    }
    const body = req.body as {
      title?: string;
      summary?: string;
      affectedFeatures?: string[];
      sourceRef?: string;
      body?: string;
      date?: string;
    };
    const title = (body.title ?? "").trim();
    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    const existingContent = await readTextFile("products", productId, "DECISIONS.md");
    const existing: Decision[] = existingContent === null ? [] : parseDecisionsMarkdown(existingContent);
    const newId = nextDecisionId(existing);
    const newDecision: Decision = {
      id: newId,
      date: (body.date ?? new Date().toISOString().slice(0, 10)).trim(),
      title,
      status: "active",
      summary: (body.summary ?? "").trim(),
      affectedFeatures: Array.isArray(body.affectedFeatures) ? body.affectedFeatures : [],
      sourceRef: (body.sourceRef ?? "").trim(),
      body: (body.body ?? "").trim()
    };
    const block = renderDecisionBlock(newDecision);
    const filePath = path.join(dataPath("products", productId), "DECISIONS.md");
    let nextContent: string;
    if (existingContent === null) {
      nextContent = `# 决策日志\n\n${block}\n`;
    } else {
      const trimmed = existingContent.replace(/\s+$/, "");
      nextContent = `${trimmed}\n\n${block}\n`;
    }
    await fs.writeFile(filePath, nextContent, "utf8");
    bumpDataVersion(`products/${productId}/DECISIONS.md`);

    res.status(201).json({ data: newDecision, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /decisions/:did/status
 *   body: { status: 'active' | 'superseded' | 'archived' }
 *   → 改写 DECISIONS.md 中该 H3 块头的 [status] 标签。
 *   决策必须以 H3 块形态存在(legacy 表格形态不支持改 status,因为没有承载位)。
 */
productSpecRouter.patch("/decisions/:did/status", async (req, res, next) => {
  const productId = (req.params as { id?: string }).id;
  const did = (req.params as { did?: string }).did;
  if (!productId || !did) {
    res.status(400).json({ error: "missing params" });
    return;
  }
  if (!/^D-\d+$/.test(did)) {
    res.status(400).json({ error: "invalid decision id" });
    return;
  }
  const targetStatus = (req.body as { status?: string }).status;
  if (!targetStatus || !["active", "superseded", "archived"].includes(targetStatus)) {
    res.status(400).json({ error: "invalid status" });
    return;
  }
  try {
    const content = await readTextFile("products", productId, "DECISIONS.md");
    if (content === null) {
      res.status(404).json({ error: "DECISIONS.md not found" });
      return;
    }
    // 仅处理 H3 块(legacy 表格行无法改 status)
    const headerRe = new RegExp(`^(###\\s+${did}\\b[^\\n]*?)(\\s*\\[(?:active|superseded|archived)\\])?\\s*$`, "m");
    if (!headerRe.test(content)) {
      res.status(404).json({
        error: `decision ${did} not found as H3 block (legacy table rows can't change status; edit DECISIONS.md directly)`
      });
      return;
    }
    const next = content.replace(headerRe, `$1 [${targetStatus}]`);
    const filePath = path.join(dataPath("products", productId), "DECISIONS.md");
    await fs.writeFile(filePath, next, "utf8");
    bumpDataVersion(`products/${productId}/DECISIONS.md`);

    res.json({
      data: { id: did, status: targetStatus as DecisionStatus },
      version: getDataVersion()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /seams
 *   → 返回结构化接缝列表(从 SEAMS.md 解析)。
 *   文件缺失或空 → exists=false, seams=[]
 */
productSpecRouter.get("/seams", async (req, res, next) => {
  const productId = (req.params as { id?: string }).id;
  if (!productId) {
    res.status(400).json({ error: "missing product id" });
    return;
  }
  try {
    if (!(await productExists(productId))) {
      res.status(404).json({ error: `product not found: ${productId}` });
      return;
    }
    const content = await readTextFile("products", productId, "SEAMS.md");
    const seams: Seam[] = content === null ? [] : parseSeamsMarkdown(content);
    const last_modified = content === null ? null : await getFileMtime("products", productId, "SEAMS.md");
    res.json({
      data: { exists: content !== null, seams, last_modified },
      version: getDataVersion()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /entities-ownership
 *   → 返回结构化实体归属表(从 ENTITIES-OWNERSHIP.md 解析)。
 */
productSpecRouter.get("/entities-ownership", async (req, res, next) => {
  const productId = (req.params as { id?: string }).id;
  if (!productId) {
    res.status(400).json({ error: "missing product id" });
    return;
  }
  try {
    if (!(await productExists(productId))) {
      res.status(404).json({ error: `product not found: ${productId}` });
      return;
    }
    const content = await readTextFile("products", productId, "ENTITIES-OWNERSHIP.md");
    const last_modified = content === null ? null : await getFileMtime("products", productId, "ENTITIES-OWNERSHIP.md");
    const parsed = content === null
      ? { rows: [] as OwnershipRow[], preamble: "", trailing: "" }
      : parseEntitiesOwnership(content);
    const data: EntitiesOwnershipData = {
      exists: content !== null,
      rows: parsed.rows,
      preamble: parsed.preamble,
      trailing: parsed.trailing,
      last_modified
    };
    res.json({ data, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /entities-ownership/row
 *   body: { name, alias?, layer, maintainers, note?, group? }
 *   group: 若指定 → 插到该分组分隔行后(若分组不存在则追加文件末尾,无分组);未指定 → 直接 append 到表末。
 *   重复 name → 409
 */
productSpecRouter.post("/entities-ownership/row", async (req, res, next) => {
  const productId = (req.params as { id?: string }).id;
  if (!productId) {
    res.status(400).json({ error: "missing product id" });
    return;
  }
  try {
    if (!(await productExists(productId))) {
      res.status(404).json({ error: `product not found: ${productId}` });
      return;
    }
    const body = req.body as {
      name?: string;
      alias?: string;
      layer?: string;
      maintainers?: string;
      note?: string;
      group?: string;
    };
    const name = (body.name ?? "").trim();
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const newRow: OwnershipEntityRow = {
      kind: "entity",
      name,
      alias: (body.alias ?? "").trim(),
      layer: (body.layer ?? "").trim(),
      maintainers: (body.maintainers ?? "").trim(),
      note: (body.note ?? "").trim()
    };

    const existing = await readTextFile("products", productId, "ENTITIES-OWNERSHIP.md");
    const parsed = existing === null
      ? { rows: [] as OwnershipRow[], preamble: "", trailing: "" }
      : parseEntitiesOwnership(existing);
    if (findEntityRowIndex(parsed.rows, name) >= 0) {
      res.status(409).json({ error: `entity row already exists: ${name}` });
      return;
    }

    const targetGroup = (body.group ?? "").trim();
    const newRows = [...parsed.rows];
    if (targetGroup) {
      const gIdx = newRows.findIndex((r) => r.kind === "group" && r.name === targetGroup);
      if (gIdx >= 0) {
        // 找到分组分隔行 → 插到该分组**最后一个 entity 行**之后(下一个分组分隔行之前)
        let insertAt = gIdx + 1;
        while (insertAt < newRows.length && newRows[insertAt].kind === "entity") insertAt += 1;
        newRows.splice(insertAt, 0, newRow);
      } else {
        // 分组不存在 → 创建分组分隔行 + 加 entity
        newRows.push({ kind: "group", name: targetGroup }, newRow);
      }
    } else {
      newRows.push(newRow);
    }

    const next = renderEntitiesOwnership({
      preamble: parsed.preamble,
      rows: newRows,
      trailing: parsed.trailing
    });
    const filePath = path.join(dataPath("products", productId), "ENTITIES-OWNERSHIP.md");
    await fs.writeFile(filePath, next, "utf8");
    bumpDataVersion(`products/${productId}/ENTITIES-OWNERSHIP.md`);

    res.status(201).json({ data: newRow, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /entities-ownership/row/:name
 *   body: { alias?, layer?, maintainers?, note? }
 *   只更新指定字段;name 本身不可改(改名 = 删除 + 新建)。
 */
productSpecRouter.patch("/entities-ownership/row/:name", async (req, res, next) => {
  const productId = (req.params as { id?: string }).id;
  const targetName = (req.params as { name?: string }).name;
  if (!productId || !targetName) {
    res.status(400).json({ error: "missing params" });
    return;
  }
  try {
    const existing = await readTextFile("products", productId, "ENTITIES-OWNERSHIP.md");
    if (existing === null) {
      res.status(404).json({ error: "ENTITIES-OWNERSHIP.md not found" });
      return;
    }
    const parsed = parseEntitiesOwnership(existing);
    const idx = findEntityRowIndex(parsed.rows, targetName);
    if (idx < 0) {
      res.status(404).json({ error: `entity row not found: ${targetName}` });
      return;
    }
    const row = parsed.rows[idx] as OwnershipEntityRow;
    const body = req.body as { alias?: string; layer?: string; maintainers?: string; note?: string };
    const updated: OwnershipEntityRow = {
      ...row,
      ...(body.alias !== undefined ? { alias: body.alias.trim() } : {}),
      ...(body.layer !== undefined ? { layer: body.layer.trim() } : {}),
      ...(body.maintainers !== undefined ? { maintainers: body.maintainers.trim() } : {}),
      ...(body.note !== undefined ? { note: body.note.trim() } : {})
    };
    parsed.rows[idx] = updated;

    const next = renderEntitiesOwnership({
      preamble: parsed.preamble,
      rows: parsed.rows,
      trailing: parsed.trailing
    });
    const filePath = path.join(dataPath("products", productId), "ENTITIES-OWNERSHIP.md");
    await fs.writeFile(filePath, next, "utf8");
    bumpDataVersion(`products/${productId}/ENTITIES-OWNERSHIP.md`);

    res.json({ data: updated, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /entities-ownership/row/:name
 *   → 删除指定 entity 行(分组分隔行不可删)。
 */
productSpecRouter.delete("/entities-ownership/row/:name", async (req, res, next) => {
  const productId = (req.params as { id?: string }).id;
  const targetName = (req.params as { name?: string }).name;
  if (!productId || !targetName) {
    res.status(400).json({ error: "missing params" });
    return;
  }
  try {
    const existing = await readTextFile("products", productId, "ENTITIES-OWNERSHIP.md");
    if (existing === null) {
      res.status(404).json({ error: "ENTITIES-OWNERSHIP.md not found" });
      return;
    }
    const parsed = parseEntitiesOwnership(existing);
    const idx = findEntityRowIndex(parsed.rows, targetName);
    if (idx < 0) {
      res.status(404).json({ error: `entity row not found: ${targetName}` });
      return;
    }
    parsed.rows.splice(idx, 1);

    const next = renderEntitiesOwnership({
      preamble: parsed.preamble,
      rows: parsed.rows,
      trailing: parsed.trailing
    });
    const filePath = path.join(dataPath("products", productId), "ENTITIES-OWNERSHIP.md");
    await fs.writeFile(filePath, next, "utf8");
    bumpDataVersion(`products/${productId}/ENTITIES-OWNERSHIP.md`);

    res.json({ data: { name: targetName, deleted: true }, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /entities/derived
 *   → 派生实体清单 + stale 状态(see docs/entity-contract.md)。
 */
productSpecRouter.get("/derived-entities", async (req, res, next) => {
  const productId = (req.params as { id?: string }).id;
  if (!productId) {
    res.status(400).json({ error: "missing product id" });
    return;
  }
  try {
    if (!(await productExists(productId))) {
      res.status(404).json({ error: `product not found: ${productId}` });
      return;
    }
    const data = await loadDerivedEntitiesData(productId);
    res.json({ data, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /entities/reconcile
 *   → reconcile 报告(派生实体 vs ENTITIES-OWNERSHIP 声明的差异)。
 */
productSpecRouter.get("/derived-entities/reconcile", async (req, res, next) => {
  const productId = (req.params as { id?: string }).id;
  if (!productId) {
    res.status(400).json({ error: "missing product id" });
    return;
  }
  try {
    if (!(await productExists(productId))) {
      res.status(404).json({ error: `product not found: ${productId}` });
      return;
    }
    const data = await loadEntityReconcileReport(productId);
    res.json({ data, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /entities/questions
 *   → derived/entities/questions.md 解析 + trigger lint 结果。
 */
productSpecRouter.get("/derived-entities/questions", async (req, res, next) => {
  const productId = (req.params as { id?: string }).id;
  if (!productId) {
    res.status(400).json({ error: "missing product id" });
    return;
  }
  try {
    if (!(await productExists(productId))) {
      res.status(404).json({ error: `product not found: ${productId}` });
      return;
    }
    const data = await loadEntityQuestions(productId);
    res.json({ data, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /architectural-warnings
 *   → 结构化警告列表(从 ARCHITECTURAL-WARNINGS.md 解析)。
 */
productSpecRouter.get("/architectural-warnings", async (req, res, next) => {
  const productId = (req.params as { id?: string }).id;
  if (!productId) {
    res.status(400).json({ error: "missing product id" });
    return;
  }
  try {
    if (!(await productExists(productId))) {
      res.status(404).json({ error: `product not found: ${productId}` });
      return;
    }
    const content = await readTextFile("products", productId, "ARCHITECTURAL-WARNINGS.md");
    const last_modified = content === null ? null : await getFileMtime("products", productId, "ARCHITECTURAL-WARNINGS.md");
    const parsed = content === null
      ? { warnings: [] as ArchitecturalWarning[], preamble: "" }
      : parseWarningsMarkdown(content);
    const data: ArchitecturalWarningsData = {
      exists: content !== null,
      warnings: parsed.warnings,
      preamble: parsed.preamble,
      last_modified
    };
    res.json({ data, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /architectural-warnings
 *   body: { title, originalQuote?, interpretation?, resolution?, implication? }
 *   → 自动算下一个 id,追加到 ARCHITECTURAL-WARNINGS.md
 */
productSpecRouter.post("/architectural-warnings", async (req, res, next) => {
  const productId = (req.params as { id?: string }).id;
  if (!productId) {
    res.status(400).json({ error: "missing product id" });
    return;
  }
  try {
    if (!(await productExists(productId))) {
      res.status(404).json({ error: `product not found: ${productId}` });
      return;
    }
    const body = req.body as {
      title?: string;
      originalQuote?: string;
      interpretation?: string;
      resolution?: string;
      implication?: string;
    };
    const title = (body.title ?? "").trim();
    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    const existingContent = await readTextFile("products", productId, "ARCHITECTURAL-WARNINGS.md");
    const parsed = existingContent === null
      ? { warnings: [] as ArchitecturalWarning[], preamble: "" }
      : parseWarningsMarkdown(existingContent);
    const newId = nextWarningId(parsed.warnings);
    const newWarning: ArchitecturalWarning = {
      id: newId,
      title,
      status: "待承接",
      originalQuote: (body.originalQuote ?? "").trim(),
      interpretation: (body.interpretation ?? "").trim(),
      resolution: (body.resolution ?? "").trim(),
      implication: (body.implication ?? "").trim(),
      body: ""
    };
    const newWarnings = [...parsed.warnings, newWarning];
    const next = renderWarningsMarkdown({ preamble: parsed.preamble, warnings: newWarnings });
    const filePath = path.join(dataPath("products", productId), "ARCHITECTURAL-WARNINGS.md");
    await fs.writeFile(filePath, next, "utf8");
    bumpDataVersion(`products/${productId}/ARCHITECTURAL-WARNINGS.md`);
    res.status(201).json({ data: newWarning, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /architectural-warnings/:wid/status
 *   body: { status: 待承接 | 部分承接 | 已纳入 }
 */
productSpecRouter.patch("/architectural-warnings/:wid/status", async (req, res, next) => {
  const productId = (req.params as { id?: string }).id;
  const wid = (req.params as { wid?: string }).wid;
  if (!productId || !wid) {
    res.status(400).json({ error: "missing params" });
    return;
  }
  const targetStatus = (req.body as { status?: string }).status as WarningStatus | undefined;
  if (!targetStatus || !["待承接", "部分承接", "已纳入"].includes(targetStatus)) {
    res.status(400).json({ error: "invalid status" });
    return;
  }
  try {
    const content = await readTextFile("products", productId, "ARCHITECTURAL-WARNINGS.md");
    if (content === null) {
      res.status(404).json({ error: "ARCHITECTURAL-WARNINGS.md not found" });
      return;
    }
    const parsed = parseWarningsMarkdown(content);
    const idx = parsed.warnings.findIndex((w) => w.id === wid);
    if (idx < 0) {
      res.status(404).json({ error: `warning ${wid} not found` });
      return;
    }
    parsed.warnings[idx] = { ...parsed.warnings[idx], status: targetStatus };
    const next = renderWarningsMarkdown({ preamble: parsed.preamble, warnings: parsed.warnings });
    const filePath = path.join(dataPath("products", productId), "ARCHITECTURAL-WARNINGS.md");
    await fs.writeFile(filePath, next, "utf8");
    bumpDataVersion(`products/${productId}/ARCHITECTURAL-WARNINGS.md`);
    res.json({ data: { id: wid, status: targetStatus }, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /l0-violations
 *   → 机械化 L0 违规检测(每次请求即跑,结果不写盘 — 实时反映 source 状态)。
 */
productSpecRouter.get("/l0-violations", async (req, res, next) => {
  const productId = (req.params as { id?: string }).id;
  if (!productId) {
    res.status(400).json({ error: "missing product id" });
    return;
  }
  try {
    if (!(await productExists(productId))) {
      res.status(404).json({ error: `product not found: ${productId}` });
      return;
    }
    const data: L0ViolationsData = await runL0Lint(productId);
    res.json({ data, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

async function productExists(productId: string): Promise<boolean> {
  try {
    await fs.access(dataPath("products", productId));
    return true;
  } catch {
    return false;
  }
}

productSpecRouter.get("/spec-files", async (req, res, next) => {
  const productId = (req.params as { id?: string }).id;
  if (!productId) {
    res.status(400).json({ error: "missing product id" });
    return;
  }
  try {
    const productDir = dataPath("products", productId);
    try {
      await fs.access(productDir);
    } catch {
      res.status(404).json({ error: `product not found: ${productId}` });
      return;
    }

    const files: SpecFile[] = await Promise.all(
      SPEC_FILE_REGISTRY.map(async ({ kind, filename }) => {
        const content = await readTextFile("products", productId, filename);
        const last_modified = content === null ? null : await getFileMtime("products", productId, filename);
        return {
          kind,
          filename,
          exists: content !== null,
          content: content ?? "",
          last_modified
        };
      })
    );

    res.json({ data: files, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});
