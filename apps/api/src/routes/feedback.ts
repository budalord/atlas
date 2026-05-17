import { Router } from "express";
import type { Feedback } from "@atlas/shared";
import { getDataVersion } from "../services/watcher";
import {
  appendFeedback,
  deleteFeedback,
  FeedbackWriterError,
  generateFeedbackId,
  parseTargetString
} from "../services/feedbackWriter";

export const feedbackRouter = Router({ mergeParams: true });

const ID_RE = /^fb-\d{8}-[a-z0-9]{4,12}$/;

/**
 * POST /api/products/:id/feedback
 *   body: { target, content, id? }
 *   返回: { data: { feedback }, version }
 *
 * 副作用:在目标 md 的 frontmatter 写 needs_revision: true。
 */
feedbackRouter.post("/", async (req, res, next) => {
  try {
    const productId = (req.params as { id: string }).id;
    const { target, content, id } = req.body ?? {};

    if (typeof target !== "string" || !target.trim()) {
      res.status(400).json({ error: "target required (e.g. feature:sales:student-intake)" });
      return;
    }
    const parsedTarget = parseTargetString(target);
    if (!parsedTarget) {
      res.status(400).json({
        error: '非法 target 格式;期望 "feature:<m>:<f>" / "entity:<e>" / "entity:<m>:<e>"'
      });
      return;
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      res.status(400).json({ error: "content must be a non-empty string" });
      return;
    }
    if (id !== undefined && (typeof id !== "string" || !ID_RE.test(id))) {
      res.status(400).json({ error: "id 必须满足 fb-<YYYYMMDD>-<4-12位字母数字>" });
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const feedback: Feedback = {
      id: typeof id === "string" ? id : generateFeedbackId(today),
      date: today,
      content
    };

    try {
      const final = await appendFeedback(productId, parsedTarget, feedback);
      res.status(201).json({ data: { feedback: final }, version: getDataVersion() });
    } catch (e) {
      if (e instanceof FeedbackWriterError) {
        res.status(e.httpStatus).json({ error: e.message });
        return;
      }
      throw e;
    }
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/products/:id/feedback/:fbId
 *   body: { target }
 *   返回: { data: { ok: true }, version }
 *
 * 副作用:删完后反馈池为空,自动从 frontmatter 抹掉 needs_revision。
 */
feedbackRouter.delete("/:fbId", async (req, res, next) => {
  try {
    const productId = (req.params as { id: string; fbId: string }).id;
    const fbId = (req.params as { id: string; fbId: string }).fbId;
    const { target } = req.body ?? {};

    if (typeof target !== "string" || !target.trim()) {
      res.status(400).json({ error: "target required" });
      return;
    }
    const parsedTarget = parseTargetString(target);
    if (!parsedTarget) {
      res.status(400).json({ error: "非法 target 格式" });
      return;
    }
    if (!ID_RE.test(fbId)) {
      res.status(400).json({ error: "non-conforming feedback id" });
      return;
    }

    try {
      await deleteFeedback(productId, parsedTarget, fbId);
      res.json({ data: { ok: true }, version: getDataVersion() });
    } catch (e) {
      if (e instanceof FeedbackWriterError) {
        res.status(e.httpStatus).json({ error: e.message });
        return;
      }
      throw e;
    }
  } catch (error) {
    next(error);
  }
});
