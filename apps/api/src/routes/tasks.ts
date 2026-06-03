import { Router, Request } from "express";
import {
  approveTask,
  getQueue,
  getTask,
  getTaskChangeset,
  rejectTask,
  retryTask,
  enqueueBatch,
  acceptChangesetFile,
  rejectChangesetFile,
  deleteTask
} from "../services/taskQueue";
import type { TaskKind } from "@atlas/shared";
import { getDataVersion } from "../services/watcher";
import { createSession } from "../services/sessionOrchestrator";

type TaskReq = Request<{ tid: string }>;
type ChangesetFileReq = Request<{ tid: string; idx: string }>;

export const tasksRouter = Router();

const BATCH_KINDS: ReadonlyArray<Exclude<TaskKind, "feature-refine">> = [
  "feature-revise",
  "usecase-revise",
  "screen-generate",
  "screen-revise",
  "actor-revise",
  "entity-revise",
  "entity-derive",
  "feature-generate",
  "usecase-generate",
  "conventions-generate"
];

tasksRouter.get("/", (_req, res) => {
  res.json({ data: getQueue(), version: getDataVersion() });
});

// v0.2c §5.6c: 跨任务累积视角 — task history (落盘 ~/.atlas/products/<id>/)
tasksRouter.get("/history/:productId", async (req: Request<{ productId: string }>, res, next) => {
  try {
    const days = Math.max(1, Math.min(90, Number.parseInt(String(req.query.days ?? "7"), 10) || 7));
    const { queryTaskHistory, summarizeHistory } = await import("../services/taskHistory");
    const [records, summary] = await Promise.all([
      queryTaskHistory(req.params.productId, days),
      summarizeHistory(req.params.productId, days)
    ]);
    res.json({ data: { records, summary, days }, version: getDataVersion() });
  } catch (e) {
    next(e);
  }
});

/**
 * v0.2b1: 通用 enqueue 入口。
 * - kind=feature-refine 仍走 POST /api/products/:id/features/:fid/refine (兼容旧前端),
 *   这里只收 batch kinds。
 */
tasksRouter.post("/", (req, res) => {
  const productId = typeof req.body?.productId === "string" ? req.body.productId : "";
  const kind = req.body?.kind;
  if (!productId) {
    res.status(400).json({ error: "productId required" });
    return;
  }
  // 开发中阶段:product-instruct(规格)/ code-instruct(应用代码)不直接入队,
  // 先建 Session(规划器拆 Task 后再入队)。target 决定改规格 md 还是改真码仓代码。
  if (kind === "product-instruct" || kind === "code-instruct") {
    const instruction = typeof req.body?.instruction === "string" ? req.body.instruction.trim() : "";
    if (!instruction) {
      res.status(400).json({ error: `instruction required for ${kind}` });
      return;
    }
    const target = kind === "code-instruct" ? "code" : "spec";
    const tree = createSession(productId, instruction, target);
    res.status(201).json({ data: tree, version: getDataVersion() });
    return;
  }
  if (!BATCH_KINDS.includes(kind)) {
    res.status(400).json({
      error: `kind must be one of ${BATCH_KINDS.join(", ")} (feature-refine 走 /products/:id/features/:fid/refine)`
    });
    return;
  }
  const task = enqueueBatch({ productId, kind });
  res.status(201).json({ data: task, version: getDataVersion() });
});

tasksRouter.get("/:tid", (req: TaskReq, res) => {
  const t = getTask(req.params.tid);
  if (!t) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  res.json({ data: t, version: getDataVersion() });
});

tasksRouter.get("/:tid/changeset", (req: TaskReq, res) => {
  const changeset = getTaskChangeset(req.params.tid);
  if (changeset === null) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  res.json({ data: changeset, version: getDataVersion() });
});

tasksRouter.post("/:tid/approve", async (req: TaskReq, res, next) => {
  try {
    const result = await approveTask(req.params.tid);
    if ("error" in result && !("id" in result)) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ data: result, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

tasksRouter.post("/:tid/reject", async (req: TaskReq, res, next) => {
  try {
    const result = await rejectTask(req.params.tid);
    if ("error" in result && !("id" in result)) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ data: result, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

tasksRouter.delete("/:tid", async (req: TaskReq, res, next) => {
  try {
    const result = await deleteTask(req.params.tid);
    if ("error" in result && !("id" in result)) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json({ data: result, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

tasksRouter.post("/:tid/retry", async (req: TaskReq, res, next) => {
  try {
    const extra = typeof req.body?.extra === "string" ? req.body.extra : undefined;
    const result = await retryTask(req.params.tid, extra);
    if ("error" in result && !("id" in result)) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ data: result, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

tasksRouter.post("/:tid/changeset/:idx/accept", (req: ChangesetFileReq, res) => {
  const idx = Number.parseInt(req.params.idx, 10);
  if (!Number.isFinite(idx)) {
    res.status(400).json({ error: "idx must be integer" });
    return;
  }
  const result = acceptChangesetFile(req.params.tid, idx);
  if ("error" in result && !("id" in result)) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ data: result, version: getDataVersion() });
});

tasksRouter.post("/:tid/changeset/:idx/reject", async (req: ChangesetFileReq, res, next) => {
  try {
    const idx = Number.parseInt(req.params.idx, 10);
    if (!Number.isFinite(idx)) {
      res.status(400).json({ error: "idx must be integer" });
      return;
    }
    const result = await rejectChangesetFile(req.params.tid, idx);
    if ("error" in result && !("id" in result)) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ data: result, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});
