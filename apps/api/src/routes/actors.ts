import { Request, Router } from "express";
import type { Actor, ActorSource, ActorType } from "@atlas/shared";
import {
  attachActorRefs,
  deleteActor,
  loadActor,
  loadActors,
  writeActor
} from "../services/actorLoader";
import { loadCapabilities } from "../services/capabilityLoader";
import { loadUseCases } from "../services/usecaseLoader";
import { loadModules, loadFeatures } from "../services/entityLoader";
import { parseGlobalFeedbackFile } from "../services/globalFeedbackParser";
import { bumpDataVersion, getDataVersion } from "../services/watcher";

const ID_RE = /^[a-z][a-z0-9-]*$/;
const VALID_TYPES: ActorType[] = ["internal_user", "external_user", "external_system"];
const VALID_SOURCES: ActorSource[] = ["user_input", "agent_suggested", "inferred_from_function"];

export const actorsRouter = Router({ mergeParams: true });

/**
 * GET /api/products/:id/actors — 列出全部 actor (含运行时聚合反向引用)
 */
actorsRouter.get("/", async (req: Request<{ id: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const [actors, capabilities, modules, usecases] = await Promise.all([
      loadActors(productId),
      loadCapabilities(productId),
      loadModules(productId),
      loadUseCases(productId)
    ]);
    // collect all functions
    const functions = [];
    for (const m of modules) {
      const fs = await loadFeatures(productId, m.name);
      functions.push(...fs);
    }
    const withRefs = attachActorRefs(actors, capabilities, functions, usecases);
    // actor-revise 由全局需求池(entity 段复用为 actor 决策容器)驱动;池空 = 无待处理项,
    // 前端据此置灰「更新角色」按钮(actor 没有自己的反馈池)。
    const globalPool = await parseGlobalFeedbackFile(productId);
    const pendingWork = globalPool.entity.length > 0;
    res.json({ data: withRefs, pendingWork, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/products/:id/actors/:actorId — 单个 actor 含 refs
 */
actorsRouter.get("/:actorId", async (req: Request<{ id: string; actorId: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const actor = await loadActor(productId, req.params.actorId);
    if (!actor) {
      res.status(404).json({ error: `actor not found: ${req.params.actorId}` });
      return;
    }
    const [capabilities, modules, usecases] = await Promise.all([
      loadCapabilities(productId),
      loadModules(productId),
      loadUseCases(productId)
    ]);
    const functions = [];
    for (const m of modules) {
      const fs = await loadFeatures(productId, m.name);
      functions.push(...fs);
    }
    const [withRefs] = attachActorRefs([actor], capabilities, functions, usecases);
    res.json({ data: withRefs, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/products/:id/actors — body: { id, name, type, source?, confirmed?, code?, responsibilities?, body? }
 */
actorsRouter.post("/", async (req: Request<{ id: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const type = body.type;
    if (!ID_RE.test(id)) {
      res.status(400).json({ error: "id 必须 kebab-case (字母开头, 只含小写字母数字和连字符)" });
      return;
    }
    if (!name) {
      res.status(400).json({ error: "name 必填" });
      return;
    }
    if (typeof type !== "string" || !VALID_TYPES.includes(type as ActorType)) {
      res.status(400).json({ error: `type 必须是 ${VALID_TYPES.join(" | ")}` });
      return;
    }
    const existing = await loadActor(productId, id);
    if (existing) {
      res.status(409).json({ error: `actor 已存在: ${id}` });
      return;
    }
    const actor: Actor = {
      id,
      name,
      type: type as ActorType,
      source: VALID_SOURCES.includes(body.source as ActorSource)
        ? (body.source as ActorSource)
        : "user_input",
      confirmed: body.confirmed === true,
      ...(typeof body.code === "string" && body.code.trim() ? { code: body.code.trim() } : {}),
      ...(typeof body.responsibilities === "string" && body.responsibilities.trim()
        ? { responsibilities: body.responsibilities.trim() }
        : {}),
      body: typeof body.body === "string" ? body.body : ""
    };
    await writeActor(productId, actor);
    bumpDataVersion(`products/${productId}/actors/${id}.md`);
    res.json({ data: actor, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/products/:id/actors/:actorId — body 同 POST(允许部分更新)
 */
actorsRouter.patch("/:actorId", async (req: Request<{ id: string; actorId: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const actorId = req.params.actorId;
    const existing = await loadActor(productId, actorId);
    if (!existing) {
      res.status(404).json({ error: `actor not found: ${actorId}` });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated: Actor = {
      ...existing,
      ...(typeof body.name === "string" && body.name.trim() ? { name: body.name.trim() } : {}),
      ...(typeof body.type === "string" && VALID_TYPES.includes(body.type as ActorType)
        ? { type: body.type as ActorType }
        : {}),
      ...(typeof body.source === "string" && VALID_SOURCES.includes(body.source as ActorSource)
        ? { source: body.source as ActorSource }
        : {}),
      ...(typeof body.confirmed === "boolean" ? { confirmed: body.confirmed } : {}),
      ...(typeof body.code === "string" ? { code: body.code.trim() || undefined } : {}),
      ...(typeof body.responsibilities === "string"
        ? { responsibilities: body.responsibilities.trim() || undefined }
        : {}),
      ...(typeof body.body === "string" ? { body: body.body } : {})
    };
    // 处理 code / responsibilities undefined 情形(否则 spread 不删字段)
    if (body.code === "" || body.code === null) delete (updated as Partial<Actor>).code;
    if (body.responsibilities === "" || body.responsibilities === null) {
      delete (updated as Partial<Actor>).responsibilities;
    }
    await writeActor(productId, updated);
    bumpDataVersion(`products/${productId}/actors/${actorId}.md`);
    res.json({ data: updated, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/products/:id/actors/:actorId — 仅删 actor.md,不级联 capability/function 引用
 *  (悬空引用由 l0Linter 规则 6 检出)
 */
actorsRouter.delete("/:actorId", async (req: Request<{ id: string; actorId: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const actorId = req.params.actorId;
    const ok = await deleteActor(productId, actorId);
    if (!ok) {
      res.status(404).json({ error: `actor not found: ${actorId}` });
      return;
    }
    bumpDataVersion(`products/${productId}/actors/${actorId}.md`);
    res.json({ data: { deleted: actorId }, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});
