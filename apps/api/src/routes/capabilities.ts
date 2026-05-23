import { Request, Router } from "express";
import type {
  Capability,
  CapabilityPriority,
  CapabilitySource,
  CapabilityStatus
} from "@atlas/shared";
import {
  attachCapabilityRefs,
  deleteCapability,
  DOMAIN_POOL,
  loadCapabilities,
  loadCapability,
  writeCapability
} from "../services/capabilityLoader";
import { loadActors } from "../services/actorLoader";
import { loadFeatures, loadModules } from "../services/entityLoader";
import { bumpDataVersion, getDataVersion } from "../services/watcher";

const ID_RE = /^[a-z][a-z0-9-]*$/;
const VALID_PRIORITIES: CapabilityPriority[] = ["P0", "P1", "P2"];
const VALID_STATUSES: CapabilityStatus[] = ["draft", "confirmed"];
const VALID_SOURCES: CapabilitySource[] = ["user_input", "agent_suggested", "inferred_from_features"];

export const capabilitiesRouter = Router({ mergeParams: true });

async function loadAllFunctions(productId: string) {
  const modules = await loadModules(productId);
  const all = [];
  for (const m of modules) {
    const fs = await loadFeatures(productId, m.name);
    all.push(...fs);
  }
  return all;
}

/** GET / — 列出全部 capability(含 function_ids 反向聚合) */
capabilitiesRouter.get("/", async (req: Request<{ id: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const [capabilities, functions] = await Promise.all([
      loadCapabilities(productId),
      loadAllFunctions(productId)
    ]);
    const withRefs = attachCapabilityRefs(capabilities, functions);
    res.json({ data: withRefs, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/** GET /:capabilityId — 单个 capability 含 refs */
capabilitiesRouter.get("/:capabilityId", async (req: Request<{ id: string; capabilityId: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const cap = await loadCapability(productId, req.params.capabilityId);
    if (!cap) {
      res.status(404).json({ error: `capability not found: ${req.params.capabilityId}` });
      return;
    }
    const functions = await loadAllFunctions(productId);
    const [withRefs] = attachCapabilityRefs([cap], functions);
    res.json({ data: withRefs, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/**
 * POST / — body: { id, name, domain, value_statement, actor_ids[], entity_ids[], priority?, status?, source?, confirmed?, body? }
 *
 * 校验:
 *   - id kebab-case + 不重复
 *   - name 非空
 *   - domain 必填 (允许 DOMAIN_POOL 外的, 但 UI 会标 ⚠)
 *   - actor_ids 全部存在 (warn-level: 不存在的也允许写, 但 l0 警告)
 */
capabilitiesRouter.post("/", async (req: Request<{ id: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const domain = typeof body.domain === "string" ? body.domain.trim() : "";
    if (!ID_RE.test(id)) {
      res.status(400).json({ error: "id 必须 kebab-case" });
      return;
    }
    if (!name) {
      res.status(400).json({ error: "name 必填" });
      return;
    }
    if (!domain) {
      res.status(400).json({ error: `domain 必填 (推荐从 ${DOMAIN_POOL.join("/")} 中选)` });
      return;
    }
    const existing = await loadCapability(productId, id);
    if (existing) {
      res.status(409).json({ error: `capability 已存在: ${id}` });
      return;
    }
    const cap: Capability = {
      id,
      name,
      domain,
      value_statement: typeof body.value_statement === "string" ? body.value_statement.trim() : "",
      actor_ids: Array.isArray(body.actor_ids)
        ? body.actor_ids.filter((x): x is string => typeof x === "string")
        : [],
      entity_ids: Array.isArray(body.entity_ids)
        ? body.entity_ids.filter((x): x is string => typeof x === "string")
        : [],
      priority: VALID_PRIORITIES.includes(body.priority as CapabilityPriority)
        ? (body.priority as CapabilityPriority)
        : "P1",
      status: VALID_STATUSES.includes(body.status as CapabilityStatus)
        ? (body.status as CapabilityStatus)
        : "draft",
      source: VALID_SOURCES.includes(body.source as CapabilitySource)
        ? (body.source as CapabilitySource)
        : "user_input",
      confirmed: body.confirmed === true,
      body: typeof body.body === "string" ? body.body : ""
    };
    await writeCapability(productId, cap);
    bumpDataVersion(`products/${productId}/capabilities/${id}.md`);
    res.json({ data: cap, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/** PATCH /:capabilityId — 部分更新 */
capabilitiesRouter.patch("/:capabilityId", async (req: Request<{ id: string; capabilityId: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const existing = await loadCapability(productId, req.params.capabilityId);
    if (!existing) {
      res.status(404).json({ error: `capability not found: ${req.params.capabilityId}` });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated: Capability = {
      ...existing,
      ...(typeof body.name === "string" && body.name.trim() ? { name: body.name.trim() } : {}),
      ...(typeof body.domain === "string" && body.domain.trim() ? { domain: body.domain.trim() } : {}),
      ...(typeof body.value_statement === "string"
        ? { value_statement: body.value_statement.trim() }
        : {}),
      ...(Array.isArray(body.actor_ids)
        ? { actor_ids: body.actor_ids.filter((x): x is string => typeof x === "string") }
        : {}),
      ...(Array.isArray(body.entity_ids)
        ? { entity_ids: body.entity_ids.filter((x): x is string => typeof x === "string") }
        : {}),
      ...(VALID_PRIORITIES.includes(body.priority as CapabilityPriority)
        ? { priority: body.priority as CapabilityPriority }
        : {}),
      ...(VALID_STATUSES.includes(body.status as CapabilityStatus)
        ? { status: body.status as CapabilityStatus }
        : {}),
      ...(VALID_SOURCES.includes(body.source as CapabilitySource)
        ? { source: body.source as CapabilitySource }
        : {}),
      ...(typeof body.confirmed === "boolean" ? { confirmed: body.confirmed } : {}),
      ...(typeof body.body === "string" ? { body: body.body } : {})
    };
    await writeCapability(productId, updated);
    bumpDataVersion(`products/${productId}/capabilities/${req.params.capabilityId}.md`);
    res.json({ data: updated, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/** DELETE /:capabilityId — 仅删 capability.md, 不级联 function.capability_id(由 l0 lint 兜底) */
capabilitiesRouter.delete("/:capabilityId", async (req: Request<{ id: string; capabilityId: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const ok = await deleteCapability(productId, req.params.capabilityId);
    if (!ok) {
      res.status(404).json({ error: `capability not found: ${req.params.capabilityId}` });
      return;
    }
    bumpDataVersion(`products/${productId}/capabilities/${req.params.capabilityId}.md`);
    res.json({ data: { deleted: req.params.capabilityId }, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

/** GET /api/products/:id/capabilities/_/domain-pool — 返回 domain 预定义池 */
capabilitiesRouter.get("/_/domain-pool", (_req, res) => {
  res.json({ data: { pool: DOMAIN_POOL }, version: getDataVersion() });
});
