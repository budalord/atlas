import { Router, Request } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  validateByScope,
  type Scope,
  type ValidationResult
} from "../services/schemaValidator";
import {
  listPendingFeedback,
  listGlobalFeedback,
  type FeedbackScope
} from "../services/feedbackQuery";
import { loadFeature, loadEntity, featureFilePath } from "../services/entityLoader";
import { loadUseCases, usecasePath } from "../services/usecaseLoader";
import { loadScreens, screenFilePath } from "../services/screenLoader";
import { loadActor, actorsDir } from "../services/actorLoader";
import {
  listPendingPrototypes,
  submitPrototype,
  PrototypeSubmitError
} from "../services/prototypeQueue";
import { dataPath } from "../services/fileReader";
import { getDataVersion, bumpDataVersion } from "../services/watcher";

/**
 * v0.2c §5.3: agent-facing HTTP API.
 *
 * 给 batch 跑的 codex agent 用 (通过 Bash curl 调用), 等价 MCP 工具:
 * - validate/<scope>: schema 校验, 返 errors[]
 * - GET feature/entity/usecase/screen/actor: 结构化对象
 * - GET feedback: 反馈池查询
 * - propose/<scope>: 一次性带校验的写入
 *
 * 与 PM-facing /api/products/:id/* 路由区分, 不混用。
 */

export const agentApiRouter = Router();

const VALID_SCOPES: Scope[] = ["feature", "entity", "usecase", "screen", "actor"];

function isScope(s: unknown): s is Scope {
  return typeof s === "string" && VALID_SCOPES.includes(s as Scope);
}

// ============================================================
// POST /api/agent/validate/:scope
// body: { productId, content, targetId?, moduleName? }
// 200 if ok; 422 if errors. body always: { ok, errors }
// ============================================================
agentApiRouter.post("/validate/:scope", (req: Request<{ scope: string }>, res) => {
  const { scope } = req.params;
  if (!isScope(scope)) {
    res.status(400).json({ error: `scope must be one of ${VALID_SCOPES.join(", ")}` });
    return;
  }
  const content = typeof req.body?.content === "string" ? req.body.content : "";
  const targetId = typeof req.body?.targetId === "string" ? req.body.targetId : "_inline";
  const moduleName = typeof req.body?.moduleName === "string" ? req.body.moduleName : undefined;
  if (!content) {
    res.status(400).json({ error: "body.content required (markdown 全文)" });
    return;
  }
  const result: ValidationResult = validateByScope(scope, targetId, content, moduleName);
  res.status(result.ok ? 200 : 422).json(result);
});

// ============================================================
// GET inspect endpoints — 结构化读
// ============================================================
agentApiRouter.get(
  "/feature/:productId/:featureId",
  async (req: Request<{ productId: string; featureId: string }>, res, next) => {
    try {
      const located = await loadFeature(req.params.productId, req.params.featureId);
      if (!located) {
        res.status(404).json({ error: "feature not found" });
        return;
      }
      res.json({ data: located, version: getDataVersion() });
    } catch (e) {
      next(e);
    }
  }
);

agentApiRouter.get(
  "/entity/:productId/:entityName",
  async (req: Request<{ productId: string; entityName: string }>, res, next) => {
    try {
      const e = await loadEntity(req.params.productId, req.params.entityName);
      if (!e) {
        res.status(404).json({ error: "entity not found" });
        return;
      }
      res.json({ data: e, version: getDataVersion() });
    } catch (e) {
      next(e);
    }
  }
);

agentApiRouter.get(
  "/usecase/:productId/:usecaseId",
  async (req: Request<{ productId: string; usecaseId: string }>, res, next) => {
    try {
      const all = await loadUseCases(req.params.productId);
      const uc = all.find((u) => u.id === req.params.usecaseId);
      if (!uc) {
        res.status(404).json({ error: "usecase not found" });
        return;
      }
      res.json({ data: uc, version: getDataVersion() });
    } catch (e) {
      next(e);
    }
  }
);

agentApiRouter.get(
  "/screen/:productId/:screenId",
  async (req: Request<{ productId: string; screenId: string }>, res, next) => {
    try {
      const all = await loadScreens(req.params.productId);
      const sc = all.find((s) => s.id === req.params.screenId);
      if (!sc) {
        res.status(404).json({ error: "screen not found" });
        return;
      }
      res.json({ data: sc, version: getDataVersion() });
    } catch (e) {
      next(e);
    }
  }
);

agentApiRouter.get(
  "/actor/:productId/:actorId",
  async (req: Request<{ productId: string; actorId: string }>, res, next) => {
    try {
      const ac = await loadActor(req.params.productId, req.params.actorId);
      if (!ac) {
        res.status(404).json({ error: "actor not found" });
        return;
      }
      res.json({ data: ac, version: getDataVersion() });
    } catch (e) {
      next(e);
    }
  }
);

// ============================================================
// GET /api/agent/feedback?productId=&scope=&global=
// scope: feature/entity/usecase/screen (object-level) 或省略 = 全部
// global=1 时返回 GLOBAL-FEEDBACK.md 三段, scope 可限 feature/entity/prototype
// ============================================================
agentApiRouter.get("/feedback", async (req, res, next) => {
  try {
    const productId = typeof req.query.productId === "string" ? req.query.productId : "";
    if (!productId) {
      res.status(400).json({ error: "productId query required" });
      return;
    }
    const isGlobal = req.query.global === "1" || req.query.global === "true";
    const scopeRaw = typeof req.query.scope === "string" ? req.query.scope : undefined;

    if (isGlobal) {
      const allowed = ["feature", "entity", "prototype"];
      const scope = scopeRaw && allowed.includes(scopeRaw) ? (scopeRaw as "feature" | "entity" | "prototype") : undefined;
      const data = await listGlobalFeedback(productId, scope);
      res.json({ data, version: getDataVersion() });
      return;
    }
    const objAllowed: FeedbackScope[] = ["feature", "entity", "usecase", "screen"];
    const scope =
      scopeRaw && (objAllowed as string[]).includes(scopeRaw) ? (scopeRaw as FeedbackScope) : undefined;
    const data = await listPendingFeedback(productId, scope);
    res.json({ data, version: getDataVersion() });
  } catch (e) {
    next(e);
  }
});

// ============================================================
// POST /api/agent/propose/:scope
// body: { productId, targetId, moduleName?, content }
// 内部跑 validate; 通过则原子写文件; 不通过 return 422 + errors
// ============================================================
agentApiRouter.post("/propose/:scope", async (req: Request<{ scope: string }>, res, next) => {
  try {
    const { scope } = req.params;
    if (!isScope(scope)) {
      res.status(400).json({ error: `scope must be one of ${VALID_SCOPES.join(", ")}` });
      return;
    }
    const productId = typeof req.body?.productId === "string" ? req.body.productId : "";
    const targetId = typeof req.body?.targetId === "string" ? req.body.targetId : "";
    const moduleName = typeof req.body?.moduleName === "string" ? req.body.moduleName : undefined;
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    if (!productId || !targetId || !content) {
      res.status(400).json({ error: "body required: productId, targetId, content" });
      return;
    }

    const validation = validateByScope(scope, targetId, content, moduleName);
    if (!validation.ok) {
      res.status(422).json({ ok: false, errors: validation.errors });
      return;
    }

    // 解析目标路径
    let target: string;
    switch (scope) {
      case "feature":
        if (!moduleName) {
          res.status(400).json({ error: "feature scope requires moduleName" });
          return;
        }
        target = featureFilePath(productId, moduleName, targetId);
        break;
      case "entity":
        // 仅写顶层 entities/<id>.md — 模块级 entity / derived entity 由 PM 流程管理
        target = dataPath("products", productId, "entities", `${targetId}.md`);
        break;
      case "usecase":
        if (!moduleName) {
          res.status(400).json({ error: "usecase scope requires moduleName" });
          return;
        }
        target = usecasePath(productId, moduleName, targetId);
        break;
      case "screen":
        if (!moduleName) {
          res.status(400).json({ error: "screen scope requires moduleName" });
          return;
        }
        target = screenFilePath(productId, moduleName, targetId);
        break;
      case "actor":
        target = path.join(actorsDir(productId), `${targetId}.md`);
        break;
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    bumpDataVersion(`agent:propose:${scope}:${targetId}`);

    res.json({
      ok: true,
      errors: validation.errors, // 可能含 warn 级
      path: target,
      version: getDataVersion()
    });
  } catch (e) {
    next(e);
  }
});

// ============================================================
// 原型图轨 (双轨设计 · 界面轨视觉产物) — codex 客户端 drain 会话用
//   GET  /prototypes/pending?productId=   → 待出图队列 (needs_prototype=true 的 screen)
//   POST /prototypes/submit               → 回传原型图, 写【暂存待审】pending_prototype + 清 flag
//                                           (不直接生效;PM 审核通过才升为 preview_image)
// 屏规格直接复用 GET /screen/:productId/:screenId。
// 背景见 memory: codex-prototype-image-track。一屏一闭环: 出一张立刻 submit 再出下一张。
// ============================================================
agentApiRouter.get("/prototypes/pending", async (req, res, next) => {
  try {
    const productId = typeof req.query.productId === "string" ? req.query.productId : "";
    if (!productId) {
      res.status(400).json({ error: "productId query required" });
      return;
    }
    const data = await listPendingPrototypes(productId);
    res.json({ data, version: getDataVersion() });
  } catch (e) {
    next(e);
  }
});

agentApiRouter.post("/prototypes/submit", async (req, res, next) => {
  try {
    const productId = typeof req.body?.productId === "string" ? req.body.productId : "";
    const moduleName = typeof req.body?.module === "string" ? req.body.module : "";
    const screenId = typeof req.body?.screenId === "string" ? req.body.screenId : "";
    const imagePath = typeof req.body?.imagePath === "string" ? req.body.imagePath : "";
    if (!productId || !moduleName || !screenId || !imagePath) {
      res.status(400).json({ error: "body required: productId, module, screenId, imagePath" });
      return;
    }
    const result = await submitPrototype({ productId, moduleName, screenId, imagePath });
    bumpDataVersion(`agent:prototype:submit:${moduleName}/${screenId}`);
    res.json({ ok: true, ...result, version: getDataVersion() });
  } catch (e) {
    if (e instanceof PrototypeSubmitError) {
      res.status(e.httpStatus).json({ error: e.message });
      return;
    }
    next(e);
  }
});
