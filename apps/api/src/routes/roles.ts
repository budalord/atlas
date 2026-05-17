import { Router } from "express";
import { loadRolesRegistry } from "../services/rolesRegistry";
import { getDataVersion } from "../services/watcher";

export const rolesRouter = Router();

/** GET /api/roles — 全局角色注册表(data/roles.yml)。 */
rolesRouter.get("/", async (_req, res, next) => {
  try {
    const registry = await loadRolesRegistry();
    res.json({ data: registry, version: getDataVersion() });
  } catch (e) {
    next(e);
  }
});
