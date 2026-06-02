import { Router, Request } from "express";
import { getDataVersion } from "../services/watcher";
import { getSessionTree, listSessionsForProduct } from "../services/sessionOrchestrator";

/**
 * 开发中阶段 Session 编排树的只读视图。
 * 创建 Session 走 POST /api/tasks {kind:"product-instruct"}(见 tasks.ts);
 * 审核仍走 /api/tasks/:tid/approve|reject|changeset(Task 粒度,复用现有三态闸)。
 */

/** GET /api/sessions/:sid — 单个 Session 树。 */
export const sessionsRouter = Router();
sessionsRouter.get("/:sid", (req: Request<{ sid: string }>, res) => {
  const tree = getSessionTree(req.params.sid);
  if (!tree) {
    res.status(404).json({ error: "session not found" });
    return;
  }
  res.json({ data: tree, version: getDataVersion() });
});

/** GET /api/products/:id/sessions — 该产品的全部 Session 树(新在前)。 */
export const productSessionsRouter = Router({ mergeParams: true });
productSessionsRouter.get("/", (req: Request<{ id: string }>, res) => {
  res.json({ data: listSessionsForProduct(req.params.id), version: getDataVersion() });
});
