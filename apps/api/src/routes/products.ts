import { Router } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Product, ProductMeta, ProductStatus, ProductTheme } from "@atlas/shared";
import { dataPath, listDirectories, readTextFile } from "../services/fileReader";
import { getDataVersion } from "../services/watcher";
import { normalizeProductMeta, parseStatusMarkdown, parseYaml } from "../services/markdownParser";
import { blankStatusMarkdown } from "../services/productScaffold";
import { parseAggregateMd, AggregateValidationError } from "../services/aggregateMdParser";
import { importAggregate, AggregateImportConflict } from "../services/aggregateMdImporter";
import { allowedTransitions, isAllowed } from "../services/productStatusFsm";
import { loadModulesWithFeatures, loadEntities } from "../services/entityLoader";

export const productsRouter = Router();

const ID_RE = /^[a-z][a-z0-9-]*$/;
const VALID_THEMES: ProductTheme[] = ["seo", "erp", "miniapp", "tool"];

productsRouter.get("/", async (_req, res, next) => {
  try {
    const products = await readProducts();
    res.json({ data: products, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/products/blank — 创建一个立项期产品。绕开 Intake Wizard,
 * 只写最小骨架(meta.yml + 空 STATUS.md),状态为 "planning"。
 * 注意:本路由必须在 GET /:id 之前注册,避免被 :id 参数匹配吞掉。
 */
productsRouter.post("/blank", async (req, res, next) => {
  try {
    const { id, name, theme, tagline } = req.body ?? {};

    if (typeof id !== "string" || !ID_RE.test(id)) {
      res.status(400).json({ error: "Invalid id (kebab-case, starts with a letter)" });
      return;
    }
    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "name required" });
      return;
    }
    if (typeof theme !== "string" || !VALID_THEMES.includes(theme as ProductTheme)) {
      res.status(400).json({ error: `theme must be one of ${VALID_THEMES.join(", ")}` });
      return;
    }

    const productDir = dataPath("products", id);
    try {
      await fs.access(productDir);
      res.status(409).json({ error: "Product directory already exists" });
      return;
    } catch {
      // not exists, proceed
    }

    await fs.mkdir(productDir, { recursive: true });

    const today = new Date().toISOString().slice(0, 10);
    const meta: ProductMeta = {
      id,
      name: name.trim(),
      theme: theme as ProductTheme,
      status: "planning",
      tech_stack: [],
      source_path: null,
      deploy_url: null,
      created_at: today,
      tagline: typeof tagline === "string" && tagline.trim() ? tagline.trim() : null,
      repo: null
    };
    await fs.writeFile(path.join(productDir, "meta.yml"), YAML.stringify(meta), "utf8");
    await fs.writeFile(path.join(productDir, "STATUS.md"), blankStatusMarkdown(today), "utf8");

    const product = await readProduct(id);
    res.status(201).json({ data: product, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/products/import-aggregate — 接收单文件汇总 md,解析+拆分落盘。
 * body: { source: string }
 * 注册顺序在 /blank 之后、/:id 之前。
 */
productsRouter.post("/import-aggregate", async (req, res, next) => {
  try {
    const { source } = req.body ?? {};
    if (typeof source !== "string" || source.trim().length === 0) {
      res.status(400).json({ error: "source (markdown text) required" });
      return;
    }
    let parsed;
    try {
      parsed = parseAggregateMd(source);
    } catch (e) {
      if (e instanceof AggregateValidationError) {
        res.status(400).json({ error: e.message });
        return;
      }
      throw e;
    }
    let productId;
    try {
      productId = await importAggregate(parsed);
    } catch (e) {
      if (e instanceof AggregateImportConflict) {
        res.status(409).json({ error: e.message });
        return;
      }
      throw e;
    }
    const product = await readProduct(productId);
    res.status(201).json({ data: product, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

productsRouter.get("/:id", async (req, res, next) => {
  try {
    const product = await readProduct(req.params.id);
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    res.json({ data: product, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/products/:id/extra-docs — 列出产品根目录下"未被结构化解析"的 .md。
 *
 * 用途:让 example-erp 这类把附加规格(SPEC-V1.md / SEAMS.md / DECISIONS.md / ...)
 * 放在产品目录的产品,在 Web 端 OverviewTab 也能看到这些文档,而不是只在文件系统能访问。
 *
 * 排除清单:
 *   - STATUS.md / SUMMARY.md — 已在概览/录入小结渲染
 *   - AGGREGATE-INPUT.md — 录入时的脚手架留档,无展示价值
 *
 * 返回顺序:权威源(SPEC-*.md / SPEC.md)排前,其余按文件名字母序。
 */
productsRouter.get("/:id/extra-docs", async (req, res, next) => {
  try {
    const productId = req.params.id;
    const productDir = dataPath("products", productId);
    let entries: string[];
    try {
      entries = await fs.readdir(productDir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        res.status(404).json({ error: "Product not found" });
        return;
      }
      throw e;
    }
    const SKIP = new Set(["STATUS.md", "SUMMARY.md", "AGGREGATE-INPUT.md"]);
    const mdFiles = entries.filter(
      (n) => n.endsWith(".md") && !SKIP.has(n)
    );
    // SPEC-* 排前,其余按字母序
    mdFiles.sort((a, b) => {
      const aIsSpec = a.startsWith("SPEC");
      const bIsSpec = b.startsWith("SPEC");
      if (aIsSpec && !bIsSpec) return -1;
      if (!aIsSpec && bIsSpec) return 1;
      return a.localeCompare(b);
    });
    const docs = await Promise.all(
      mdFiles.map(async (name) => {
        const full = path.join(productDir, name);
        const stat = await fs.stat(full);
        const content = await fs.readFile(full, "utf8");
        return { name, sizeBytes: stat.size, content };
      })
    );
    res.json({ data: docs, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

const VALID_STATUSES: ProductStatus[] = [
  "discovering",
  "planning",
  "in-progress",
  "paused",
  "live",
  "archived"
];

/**
 * PATCH /api/products/:id/status — body { status: ProductStatus }
 * 校验当前 status → 目标 status 是否在 fsm 允许的转移内,合法则改写 meta.yml。
 */
productsRouter.patch("/:id/status", async (req, res, next) => {
  try {
    const productId = req.params.id;
    const target = req.body?.status;
    if (typeof target !== "string" || !VALID_STATUSES.includes(target as ProductStatus)) {
      res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(", ")}` });
      return;
    }
    const metaPath = dataPath("products", productId, "meta.yml");
    let metaSource: string;
    try {
      metaSource = await fs.readFile(metaPath, "utf8");
    } catch {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const meta = normalizeProductMeta(parseYaml(metaSource));
    const next = target as ProductStatus;
    if (meta.status === next) {
      res.json({ data: await readProduct(productId), version: getDataVersion() });
      return;
    }
    if (!isAllowed(meta.status, next)) {
      res.status(400).json({
        error: `不允许 ${meta.status} → ${next};当前阶段可推进为:${allowedTransitions(meta.status).join(", ") || "无"}`
      });
      return;
    }
    const updated: ProductMeta = { ...meta, status: next };
    await fs.writeFile(metaPath, YAML.stringify(updated), "utf8");
    const product = await readProduct(productId);
    res.json({ data: product, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/products/:id/readiness — 返回两个阶段门槛的就绪度提示。
 * 这是给前端「黄牌」用的纯提示,不强制拦截推进。
 */
productsRouter.get("/:id/readiness", async (req, res, next) => {
  try {
    const product = await readProduct(req.params.id);
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const modulesWithFeatures = await loadModulesWithFeatures(req.params.id);
    const allFeatures = modulesWithFeatures.flatMap((m) => m.features);

    const entities = await loadEntities(req.params.id);
    const tbdCount = entities.reduce((acc, ent) => {
      let n = 0;
      for (const f of ent.fields) if (f.is_tbd) n++;
      for (const r of ent.relations) if (r.is_tbd) n++;
      for (const d of ent.decisions) if (d.is_tbd) n++;
      return acc + n;
    }, 0);

    const startDevHints: string[] = [];
    if (modulesWithFeatures.length === 0) startDevHints.push("尚未定义任何模块 (modules/)");
    if (allFeatures.length === 0) startDevHints.push("尚未定义任何功能点");
    if (!product.statusMarkdown || product.statusMarkdown.trim().length < 50) {
      startDevHints.push("STATUS.md 内容偏少,建议先沉淀当前状态");
    }

    // 上线门槛信息(本轮 UI 暂不读 statusMarkdown 中的 feature 表来推 P0,等后续 epic 完善)
    const goLiveHints: string[] = [];
    if (tbdCount > 0) goLiveHints.push(`${tbdCount} 项 TBD 待决议`);
    if (!product.meta.deploy_url) goLiveHints.push("meta.yml 未填 deploy_url");
    if (allFeatures.length === 0) goLiveHints.push("无功能点");

    res.json({
      data: {
        startDev: { ok: startDevHints.length === 0, hints: startDevHints },
        goLive: { ok: goLiveHints.length === 0, hints: goLiveHints }
      },
      version: getDataVersion()
    });
  } catch (error) {
    next(error);
  }
});


async function readProducts(): Promise<Product[]> {
  const ids = await listDirectories("products");
  const products = await Promise.all(ids.map((id) => readProduct(id)));
  return products
    .filter((product): product is Product => Boolean(product))
    .filter((product) => product.meta.status !== "discovering");
}

async function readProduct(id: string): Promise<Product | null> {
  const metaSource = await readTextFile("products", id, "meta.yml");
  const statusSource = await readTextFile("products", id, "STATUS.md");

  if (!metaSource || !statusSource) {
    return null;
  }

  const meta = normalizeProductMeta(parseYaml(metaSource));
  const status = parseStatusMarkdown(statusSource);

  return {
    id,
    meta,
    last_updated: status.last_updated,
    summary: status.summary,
    todos: status.todos,
    blockers: status.blockers,
    features: status.features,
    statusMarkdown: status.body
  };
}
