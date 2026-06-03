import { Router, Request } from "express";
import { getDataVersion } from "../services/watcher";
import { inspectRepo } from "../services/repoResolver";
import { buildScaffoldInstruction } from "../services/generatePromptBuilder";
import { createSession } from "../services/sessionOrchestrator";
import { loadModulesWithFeatures } from "../services/entityLoader";

/**
 * 开发阶段「决策者驾驶舱」后端:码仓体检 + 一键搭骨架 + 建造看板数据。
 * 都挂在 /api/products/:id/dev 下。搭骨架/建造复用现有 code-instruct 编排(Session→worktree→三态闸)。
 */
export const productDevRouter = Router({ mergeParams: true });

/** GET /api/products/:id/dev/status — 码仓/脚手架状态 + 模块清单(给建造看板)。 */
productDevRouter.get("/status", async (req: Request<{ id: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const repo = await inspectRepo(productId);
    const modules = await loadModulesWithFeatures(productId);
    res.json({
      data: {
        repo, // { configured, repoDir, cloned, scaffolded }
        modules: modules.map((m) => ({
          name: m.module.name,
          title: m.module.title || m.module.name,
          featureCount: m.features.length
        }))
      },
      version: getDataVersion()
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/products/:id/dev/scaffold — 一键搭骨架(单 Task code Session,跳过规划器)。 */
productDevRouter.post("/scaffold", async (req: Request<{ id: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const repo = await inspectRepo(productId);
    if (!repo.configured) {
      res.status(400).json({ error: "未配置码仓(meta.repo / 本地 repo 文件 / ATLAS_REPO_* 任一)" });
      return;
    }
    const instruction = await buildScaffoldInstruction(productId);
    const tree = createSession(productId, instruction, "code", { skipCodePlan: true });
    res.status(201).json({ data: tree, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});
