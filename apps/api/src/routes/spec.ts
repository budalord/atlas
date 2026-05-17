import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import type { ProductVision, SpecFile, SpecFileKind } from "@atlas/shared";
import { dataPath, getFileMtime, readTextFile } from "../services/fileReader";
import { getDataVersion } from "../services/watcher";

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
