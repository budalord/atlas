import path from "node:path";
import { Request, Router } from "express";
import type { Screen, ScreenEntityVisibility } from "@atlas/shared";
import { dataPath } from "../services/fileReader";
import {
  deleteScreen,
  findOrphanScreens,
  loadScreen,
  loadScreens,
  loadScreensForEntity,
  loadScreensForUseCase,
  validateScreen,
  writeScreen
} from "../services/screenLoader";
import {
  approvePrototype,
  listPendingReview,
  PrototypeError,
  queueAllMissing,
  rejectPrototype,
  setNeedsPrototype
} from "../services/prototypeQueue";
import { bumpDataVersion, getDataVersion } from "../services/watcher";

const ID_RE = /^[a-z][a-z0-9-]*$/;

export const screensRouter = Router({ mergeParams: true });

/**
 * GET /  — 列出全部 screen (跨 module)
 *   可选 ?usecase=<id> 反查承接某 usecase 的 screen
 *   可选 ?entity=<EntityName> 反查 entity_visibility 涉及某 entity 的 screen
 */
screensRouter.get("/", async (req: Request<{ id: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const usecaseFilter = typeof req.query.usecase === "string" ? req.query.usecase : null;
    const entityFilter = typeof req.query.entity === "string" ? req.query.entity : null;
    let list;
    if (usecaseFilter) list = await loadScreensForUseCase(productId, usecaseFilter);
    else if (entityFilter) list = await loadScreensForEntity(productId, entityFilter);
    else list = await loadScreens(productId);
    res.json({ data: list, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/** GET /orphans — 视图级孤儿 screen 报告 */
screensRouter.get("/orphans", async (req: Request<{ id: string }>, res, next) => {
  try {
    const issues = await findOrphanScreens(req.params.id);
    res.json({ data: issues, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/** GET /prototype-review — 原型图审核 inbox(有 pending_prototype 的 screen) */
screensRouter.get("/prototype-review", async (req: Request<{ id: string }>, res, next) => {
  try {
    const data = await listPendingReview(req.params.id);
    res.json({ data, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/** POST /queue-all-missing — 爆发期: 把所有无图/未入队的 screen 批量入队出图 */
screensRouter.post("/queue-all-missing", async (req: Request<{ id: string }>, res, next) => {
  try {
    const queued = await queueAllMissing(req.params.id);
    if (queued.length > 0) bumpDataVersion(`products/${req.params.id}/screens:queue-all`);
    res.json({ data: { queued, count: queued.length }, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/** GET /:module/:screenId — 单个 screen + validation_issues */
screensRouter.get(
  "/:module/:screenId",
  async (req: Request<{ id: string; module: string; screenId: string }>, res, next) => {
    try {
      const productId = req.params.id;
      const screen = await loadScreen(productId, req.params.module, req.params.screenId);
      if (!screen) {
        res.status(404).json({ error: `screen not found: ${req.params.module}/${req.params.screenId}` });
        return;
      }
      const validation_issues = await validateScreen(productId, screen);
      res.json({ data: { ...screen, validation_issues }, version: getDataVersion() });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /:module/:screenId/preview-image — 直接返回该屏的原型图字节。
 * 图片由 prototypeQueue.submitPrototype 复制进 screens/assets/ 并写入 screen.preview_image。
 * 路径从存储的 preview_image 派生(非用户输入), 解析后强制校验仍在产品目录内, 防越界。
 */
screensRouter.get(
  "/:module/:screenId/preview-image",
  async (req: Request<{ id: string; module: string; screenId: string }>, res, next) => {
    try {
      const productId = req.params.id;
      const screen = await loadScreen(productId, req.params.module, req.params.screenId);
      if (!screen || !screen.preview_image) {
        res.status(404).json({ error: "no preview image" });
        return;
      }
      const productDir = dataPath("products", productId);
      const abs = path.resolve(productDir, screen.preview_image);
      if (abs !== productDir && !abs.startsWith(productDir + path.sep)) {
        res.status(400).json({ error: "invalid preview path" });
        return;
      }
      res.sendFile(abs, (err) => {
        if (err && !res.headersSent) res.status(404).json({ error: "preview file missing" });
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /  — body: { id, name, module, usecase_ids, entity_visibility, body?, prototype_url?, preview_image? }
 *
 * 校验:
 *   - id / module kebab-case
 *   - 文件不存在(不覆盖)
 *   - validateScreen 通过(usecase / entity / 字段 引用闭环)
 */
screensRouter.post("/", async (req: Request<{ id: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const screen = normalizeIncomingScreen(body);
    if ("error" in screen) {
      res.status(400).json({ error: screen.error });
      return;
    }
    // 防覆盖
    const existing = await loadScreen(productId, screen.value.module, screen.value.id);
    if (existing) {
      res.status(409).json({ error: `screen 已存在: ${screen.value.module}/${screen.value.id}` });
      return;
    }
    const issues = await validateScreen(productId, screen.value);
    const errors = issues.filter((i) => i.level === "error");
    if (errors.length > 0) {
      res.status(400).json({ error: "validation failed", issues });
      return;
    }
    await writeScreen(productId, screen.value);
    bumpDataVersion(
      `products/${productId}/modules/${screen.value.module}/screens/${screen.value.id}.md`
    );
    res.status(201).json({ data: { ...screen.value, validation_issues: issues }, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/** PATCH /:module/:screenId — 部分更新, 同步校验 */
screensRouter.patch(
  "/:module/:screenId",
  async (req: Request<{ id: string; module: string; screenId: string }>, res, next) => {
    try {
      const productId = req.params.id;
      const existing = await loadScreen(productId, req.params.module, req.params.screenId);
      if (!existing) {
        res.status(404).json({ error: `screen not found` });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated: Screen = {
        ...existing,
        ...(typeof body.name === "string" && body.name.trim() ? { name: body.name.trim() } : {}),
        ...(Array.isArray(body.usecase_ids)
          ? {
              usecase_ids: body.usecase_ids.filter(
                (x): x is string => typeof x === "string" && x.length > 0
              )
            }
          : {}),
        ...(body.entity_visibility && typeof body.entity_visibility === "object"
          ? { entity_visibility: body.entity_visibility as Record<string, ScreenEntityVisibility> }
          : {}),
        ...(typeof body.prototype_url === "string"
          ? { prototype_url: body.prototype_url.trim() || undefined }
          : {}),
        ...(typeof body.preview_image === "string"
          ? { preview_image: body.preview_image.trim() || undefined }
          : {}),
        ...(typeof body.body === "string" ? { body: body.body } : {})
      };
      const issues = await validateScreen(productId, updated);
      const errors = issues.filter((i) => i.level === "error");
      if (errors.length > 0) {
        res.status(400).json({ error: "validation failed", issues });
        return;
      }
      await writeScreen(productId, updated);
      bumpDataVersion(
        `products/${productId}/modules/${updated.module}/screens/${updated.id}.md`
      );
      res.json({ data: { ...updated, validation_issues: issues }, version: getDataVersion() });
    } catch (error) {
      next(error);
    }
  }
);

/** DELETE /:module/:screenId */
screensRouter.delete(
  "/:module/:screenId",
  async (req: Request<{ id: string; module: string; screenId: string }>, res, next) => {
    try {
      const productId = req.params.id;
      const ok = await deleteScreen(productId, req.params.module, req.params.screenId);
      if (!ok) {
        res.status(404).json({ error: `screen not found` });
        return;
      }
      bumpDataVersion(
        `products/${productId}/modules/${req.params.module}/screens/${req.params.screenId}.md`
      );
      res.json({ data: { deleted: req.params.screenId }, version: getDataVersion() });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /:module/:screenId/request-prototype — 把屏标入原型图出图队列 (needs_prototype)。
 * 见 prototypeQueue.ts / memory: codex-prototype-image-track。
 */
screensRouter.post(
  "/:module/:screenId/request-prototype",
  async (req: Request<{ id: string; module: string; screenId: string }>, res, next) => {
    try {
      const productId = req.params.id;
      const ok = await setNeedsPrototype(productId, req.params.module, req.params.screenId);
      if (!ok) {
        res.status(404).json({ error: `screen not found` });
        return;
      }
      bumpDataVersion(
        `products/${productId}/modules/${req.params.module}/screens/${req.params.screenId}.md`
      );
      res.json({
        data: { screenId: req.params.screenId, needs_prototype: true },
        version: getDataVersion()
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /:module/:screenId/pending-image — 返回该屏【待审暂存】原型图字节(审核时看)。
 * 路径从存储的 pending_prototype 派生 + 越界校验, 同 preview-image。
 */
screensRouter.get(
  "/:module/:screenId/pending-image",
  async (req: Request<{ id: string; module: string; screenId: string }>, res, next) => {
    try {
      const productId = req.params.id;
      const screen = await loadScreen(productId, req.params.module, req.params.screenId);
      if (!screen || !screen.pending_prototype) {
        res.status(404).json({ error: "no pending prototype" });
        return;
      }
      const productDir = dataPath("products", productId);
      const abs = path.resolve(productDir, screen.pending_prototype);
      if (abs !== productDir && !abs.startsWith(productDir + path.sep)) {
        res.status(400).json({ error: "invalid pending path" });
        return;
      }
      res.sendFile(abs, (err) => {
        if (err && !res.headersSent) res.status(404).json({ error: "pending file missing" });
      });
    } catch (error) {
      next(error);
    }
  }
);

/** POST /:module/:screenId/approve-prototype — 审核通过: 暂存图升为 preview_image */
screensRouter.post(
  "/:module/:screenId/approve-prototype",
  async (req: Request<{ id: string; module: string; screenId: string }>, res, next) => {
    try {
      const productId = req.params.id;
      const result = await approvePrototype(productId, req.params.module, req.params.screenId);
      bumpDataVersion(
        `products/${productId}/modules/${req.params.module}/screens/${req.params.screenId}.md`
      );
      res.json({ data: result, version: getDataVersion() });
    } catch (error) {
      if (error instanceof PrototypeError) {
        res.status(error.httpStatus).json({ error: error.message });
        return;
      }
      next(error);
    }
  }
);

/**
 * POST /:module/:screenId/reject-prototype — 审核打回: 丢弃暂存图。
 * body.requeue(默认 true)= 是否重新入队让 automation 再出一版。
 */
screensRouter.post(
  "/:module/:screenId/reject-prototype",
  async (req: Request<{ id: string; module: string; screenId: string }>, res, next) => {
    try {
      const productId = req.params.id;
      const requeue = req.body?.requeue !== false; // 默认重新入队
      const result = await rejectPrototype(productId, req.params.module, req.params.screenId, requeue);
      bumpDataVersion(
        `products/${productId}/modules/${req.params.module}/screens/${req.params.screenId}.md`
      );
      res.json({ data: result, version: getDataVersion() });
    } catch (error) {
      if (error instanceof PrototypeError) {
        res.status(error.httpStatus).json({ error: error.message });
        return;
      }
      next(error);
    }
  }
);

function normalizeIncomingScreen(
  body: Record<string, unknown>
): { value: Screen } | { error: string } {
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const moduleName = typeof body.module === "string" ? body.module.trim() : "";
  if (!ID_RE.test(id)) return { error: "id 必须 kebab-case" };
  if (!ID_RE.test(moduleName)) return { error: "module 必须 kebab-case" };
  if (!name) return { error: "name 必填" };
  const usecase_ids = Array.isArray(body.usecase_ids)
    ? body.usecase_ids.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  if (usecase_ids.length === 0) return { error: "usecase_ids 必填至少 1 个" };
  const entity_visibility = (body.entity_visibility ?? {}) as Record<string, ScreenEntityVisibility>;
  return {
    value: {
      id,
      name,
      module: moduleName,
      usecase_ids,
      entity_visibility,
      ...(typeof body.prototype_url === "string" && body.prototype_url.trim()
        ? { prototype_url: body.prototype_url.trim() }
        : {}),
      ...(typeof body.preview_image === "string" && body.preview_image.trim()
        ? { preview_image: body.preview_image.trim() }
        : {}),
      body: typeof body.body === "string" ? body.body : ""
    }
  };
}
