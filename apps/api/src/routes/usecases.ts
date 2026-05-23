import { Request, Router } from "express";
import type { UseCase } from "@atlas/shared";
import {
  deleteUseCase,
  loadUseCase,
  loadUseCases,
  loadUseCasesForFunction,
  writeUseCase
} from "../services/usecaseLoader";
import { loadActor } from "../services/actorLoader";
import { loadFeature } from "../services/entityLoader";
import { bumpDataVersion, getDataVersion } from "../services/watcher";

const ID_RE = /^[a-z][a-z0-9-]*$/;

export const usecasesRouter = Router({ mergeParams: true });

/** GET / — 列出全部 usecase (可选 ?function=<id> 过滤) */
usecasesRouter.get("/", async (req: Request<{ id: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const fnFilter = typeof req.query.function === "string" ? req.query.function : null;
    const list = fnFilter
      ? await loadUseCasesForFunction(productId, fnFilter)
      : await loadUseCases(productId);
    res.json({ data: list, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/** GET /:functionId/:usecaseId — 单个 usecase  */
usecasesRouter.get(
  "/:functionId/:usecaseId",
  async (req: Request<{ id: string; functionId: string; usecaseId: string }>, res, next) => {
    try {
      const productId = req.params.id;
      // 没有索引, 全扫
      const all = await loadUseCases(productId);
      const found = all.find(
        (u) => u.function_id === req.params.functionId && u.id === req.params.usecaseId
      );
      if (!found) {
        res.status(404).json({ error: `usecase not found: ${req.params.functionId}/${req.params.usecaseId}` });
        return;
      }
      res.json({ data: found, version: getDataVersion() });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST / — body: { id, module, function_id, actor_id, entity_ids?, precondition?, postcondition?, body? }
 *
 * 校验:
 *   - id kebab-case + 在该 function 下不重复
 *   - module 必须存在
 *   - function_id 必须能 loadFeature 到
 *   - actor_id 必须能 loadActor 到
 */
usecasesRouter.post("/", async (req: Request<{ id: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const moduleName = typeof body.module === "string" ? body.module.trim() : "";
    const function_id = typeof body.function_id === "string" ? body.function_id.trim() : "";
    const actor_id = typeof body.actor_id === "string" ? body.actor_id.trim() : "";
    if (!ID_RE.test(id)) {
      res.status(400).json({ error: "id 必须 kebab-case" });
      return;
    }
    if (!moduleName || !function_id || !actor_id) {
      res.status(400).json({ error: "module / function_id / actor_id 必填" });
      return;
    }
    // 校验 function 存在
    const fn = await loadFeature(productId, function_id);
    if (!fn) {
      res.status(400).json({ error: `function_id 引用不存在: ${function_id}` });
      return;
    }
    // 校验 actor 存在
    const ac = await loadActor(productId, actor_id);
    if (!ac) {
      res.status(400).json({ error: `actor_id 引用不存在: ${actor_id}` });
      return;
    }
    // 校验 usecase id 在该 function 下不重复
    const existing = await loadUseCasesForFunction(productId, function_id);
    if (existing.some((u) => u.id === id)) {
      res.status(409).json({ error: `usecase 在 ${function_id} 下已存在: ${id}` });
      return;
    }
    const uc: UseCase = {
      id,
      module: moduleName,
      function_id,
      actor_id,
      ...(Array.isArray(body.entity_ids)
        ? { entity_ids: body.entity_ids.filter((x): x is string => typeof x === "string") }
        : {}),
      ...(typeof body.precondition === "string" && body.precondition.trim()
        ? { precondition: body.precondition.trim() }
        : {}),
      ...(typeof body.postcondition === "string" && body.postcondition.trim()
        ? { postcondition: body.postcondition.trim() }
        : {}),
      body: typeof body.body === "string" ? body.body : ""
    };
    await writeUseCase(productId, uc);
    bumpDataVersion(`products/${productId}/modules/${moduleName}/usecases/${id}.md`);
    res.json({ data: uc, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/** PATCH /:functionId/:usecaseId — 部分更新 */
usecasesRouter.patch(
  "/:functionId/:usecaseId",
  async (req: Request<{ id: string; functionId: string; usecaseId: string }>, res, next) => {
    try {
      const productId = req.params.id;
      const all = await loadUseCases(productId);
      const existing = all.find(
        (u) => u.function_id === req.params.functionId && u.id === req.params.usecaseId
      );
      if (!existing) {
        res.status(404).json({ error: `usecase not found` });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated: UseCase = {
        ...existing,
        ...(typeof body.actor_id === "string" && body.actor_id.trim()
          ? { actor_id: body.actor_id.trim() }
          : {}),
        ...(Array.isArray(body.entity_ids)
          ? { entity_ids: body.entity_ids.filter((x): x is string => typeof x === "string") }
          : {}),
        ...(typeof body.precondition === "string"
          ? { precondition: body.precondition.trim() || undefined }
          : {}),
        ...(typeof body.postcondition === "string"
          ? { postcondition: body.postcondition.trim() || undefined }
          : {}),
        ...(typeof body.body === "string" ? { body: body.body } : {})
      };
      await writeUseCase(productId, updated);
      bumpDataVersion(
        `products/${productId}/modules/${updated.module}/usecases/${updated.id}.md`
      );
      res.json({ data: updated, version: getDataVersion() });
    } catch (error) {
      next(error);
    }
  }
);

/** DELETE /:functionId/:usecaseId */
usecasesRouter.delete(
  "/:functionId/:usecaseId",
  async (req: Request<{ id: string; functionId: string; usecaseId: string }>, res, next) => {
    try {
      const productId = req.params.id;
      const all = await loadUseCases(productId);
      const existing = all.find(
        (u) => u.function_id === req.params.functionId && u.id === req.params.usecaseId
      );
      if (!existing) {
        res.status(404).json({ error: `usecase not found` });
        return;
      }
      const ok = await deleteUseCase(productId, existing.module, existing.id);
      if (!ok) {
        res.status(404).json({ error: `usecase file missing` });
        return;
      }
      bumpDataVersion(
        `products/${productId}/modules/${existing.module}/usecases/${existing.id}.md`
      );
      res.json({ data: { deleted: existing.id }, version: getDataVersion() });
    } catch (error) {
      next(error);
    }
  }
);
