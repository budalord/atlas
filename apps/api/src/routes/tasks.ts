import { Router, Request } from "express";
import {
  approveTask,
  getQueue,
  getTask,
  rejectTask,
  retryTask
} from "../services/taskQueue";
import { getDataVersion } from "../services/watcher";

type TaskReq = Request<{ tid: string }>;

export const tasksRouter = Router();

tasksRouter.get("/", (_req, res) => {
  res.json({ data: getQueue(), version: getDataVersion() });
});

tasksRouter.get("/:tid", (req: TaskReq, res) => {
  const t = getTask(req.params.tid);
  if (!t) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  res.json({ data: t, version: getDataVersion() });
});

tasksRouter.post("/:tid/approve", async (req: TaskReq, res, next) => {
  try {
    const result = await approveTask(req.params.tid);
    if ("error" in result) {
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
    if ("error" in result) {
      res.status(400).json({ error: result.error });
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
    if ("error" in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ data: result, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});
