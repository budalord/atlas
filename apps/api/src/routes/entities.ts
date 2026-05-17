import { Router, Request } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { dataPath, readTextFile } from "../services/fileReader";
import {
  loadEntities,
  loadEntity,
  loadModules,
  loadModulesWithFeatures
} from "../services/entityLoader";
import { normalizeProductMeta, parseYaml } from "../services/markdownParser";
import { getDataVersion } from "../services/watcher";

type ProductReq = Request<{ id: string }>;
type EntityReq = Request<{ id: string; name: string }>;

export const entitiesRouter = Router({ mergeParams: true });

// GET /api/products/:id/entities
entitiesRouter.get("/", async (req: ProductReq, res, next) => {
  try {
    const entities = await loadEntities(req.params.id);
    res.json({ data: entities, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/products/:id/entities/:name
entitiesRouter.delete("/:name", async (req: EntityReq, res, next) => {
  try {
    const entity = await loadEntity(req.params.id, req.params.name);
    if (!entity) {
      res.status(404).json({ error: "Entity not found" });
      return;
    }
    const filePath = entity.module
      ? dataPath("products", req.params.id, "modules", entity.module, "entities", `${entity.id}.md`)
      : dataPath("products", req.params.id, "entities", `${entity.id}.md`);
    await fs.unlink(filePath);
    res.json({ data: { id: entity.id }, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

// GET /api/products/:id/entities/:name
entitiesRouter.get("/:name", async (req: EntityReq, res, next) => {
  try {
    const entity = await loadEntity(req.params.id, req.params.name);
    if (!entity) {
      res.status(404).json({ error: "Entity not found" });
      return;
    }
    res.json({ data: entity, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

// POST /api/products/:id/entities
// body: { name: string, module: string | null }
entitiesRouter.post("/", async (req: ProductReq, res, next) => {
  try {
    const productId = req.params.id;
    const { name, module } = req.body ?? {};

    if (typeof name !== "string" || !/^[a-z][a-z0-9_-]*$/i.test(name)) {
      res.status(400).json({ error: "Invalid entity name (use letters/numbers/-/_)" });
      return;
    }
    if (module !== null && module !== undefined && typeof module !== "string") {
      res.status(400).json({ error: "module must be string or null" });
      return;
    }

    const moduleName = (module ?? null) as string | null;
    const targetDir = moduleName
      ? dataPath("products", productId, "modules", moduleName, "entities")
      : dataPath("products", productId, "entities");
    const targetFile = path.join(targetDir, `${name}.md`);

    try {
      await fs.access(targetFile);
      res.status(409).json({ error: "Entity file already exists" });
      return;
    } catch {
      // does not exist, proceed
    }

    await fs.mkdir(targetDir, { recursive: true });

    // 根据产品 status 推导 added_in_phase
    const metaSource = await readTextFile("products", productId, "meta.yml");
    const productMeta = metaSource ? normalizeProductMeta(parseYaml(metaSource)) : null;
    const isPlanning =
      !productMeta || productMeta.status === "planning" || productMeta.status === "discovering";

    const template = entityTemplate(name, isPlanning ? null : productMeta!.status);
    await fs.writeFile(targetFile, template, "utf8");

    const entity = await loadEntity(productId, name);
    res.status(201).json({ data: entity, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

function entityTemplate(name: string, addedInPhase: string | null): string {
  let frontmatter = "";
  if (addedInPhase) {
    const fm = {
      added_in_phase: addedInPhase,
      added_at: new Date().toISOString().slice(0, 10)
    };
    frontmatter = `---\n${YAML.stringify(fm).trim()}\n---\n`;
  }
  return `${frontmatter}# ${name}

## 字段
| 字段名 | 类型 | 必填 | 约束 | 备注 |
| --- | --- | --- | --- | --- |
| id | uuid | 是 | 主键 | |

## 关系

## 决策
`;
}

// 独立路由: /api/products/:id/modules 与下方的聚合端点
// (批次 4' 补丁: tbd-items / decisions 聚合端点已删除 — entity ## 决策 段和字段
//  TBD 标记继续在 entity 文件里存在并由 entityParser 解析,只是不再前端聚合展示)
export const productAuxRouter = Router({ mergeParams: true });

productAuxRouter.get("/modules", async (req: ProductReq, res, next) => {
  try {
    const modules = await loadModules(req.params.id);
    res.json({ data: modules, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

productAuxRouter.get("/modules-with-features", async (req: ProductReq, res, next) => {
  try {
    const data = await loadModulesWithFeatures(req.params.id);
    res.json({ data, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/products/:id/conventions
 * 返回 CONVENTIONS.md 的存在性 + 内容。文件不存在时 exists=false,不报 404。
 */
productAuxRouter.get("/conventions", async (req: ProductReq, res, next) => {
  try {
    const source = await readTextFile("products", req.params.id, "CONVENTIONS.md");
    if (source === null) {
      res.json({ data: { exists: false }, version: getDataVersion() });
      return;
    }
    let lastUpdated: string | null = null;
    const fmMatch = source.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      try {
        const fm = parseYaml<{ last_updated?: string }>(fmMatch[1]);
        if (fm?.last_updated) lastUpdated = fm.last_updated;
      } catch {
        /* ignore */
      }
    }
    res.json({
      data: { exists: true, content: source, last_updated: lastUpdated },
      version: getDataVersion()
    });
  } catch (error) {
    next(error);
  }
});
