import { Router } from "express";
import type { GlobalFeedbackScope } from "@atlas/shared";
import { getDataVersion } from "../services/watcher";
import { parseGlobalFeedbackFile } from "../services/globalFeedbackParser";
import {
  appendGlobalFeedback,
  deleteGlobalFeedback,
  GlobalFeedbackWriterError
} from "../services/globalFeedbackWriter";

export const globalFeedbackRouter = Router({ mergeParams: true });

const ID_RE = /^gfb-\d{8}-[a-z0-9]{4,12}$/;
const VALID_SCOPES = new Set<GlobalFeedbackScope>(["feature", "entity", "prototype"]);

/** GET /api/products/:id/global-feedback */
globalFeedbackRouter.get("/", async (req, res, next) => {
  try {
    const productId = (req.params as { id: string }).id;
    const data = await parseGlobalFeedbackFile(productId);
    res.json({ data, version: getDataVersion() });
  } catch (e) {
    next(e);
  }
});

/** POST /api/products/:id/global-feedback  body: { scope, content, id? } */
globalFeedbackRouter.post("/", async (req, res, next) => {
  try {
    const productId = (req.params as { id: string }).id;
    const { scope, content, id } = req.body ?? {};

    if (typeof scope !== "string" || !VALID_SCOPES.has(scope as GlobalFeedbackScope)) {
      res.status(400).json({ error: `scope must be one of ${Array.from(VALID_SCOPES).join("/")}` });
      return;
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      res.status(400).json({ error: "content must be a non-empty string" });
      return;
    }
    if (id !== undefined && (typeof id !== "string" || !ID_RE.test(id))) {
      res.status(400).json({ error: "id 必须满足 gfb-<YYYYMMDD>-<4-12位字母数字>" });
      return;
    }

    const entry = await appendGlobalFeedback(
      productId,
      scope as GlobalFeedbackScope,
      content,
      typeof id === "string" ? id : undefined
    );
    res.status(201).json({ data: { feedback: entry }, version: getDataVersion() });
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/products/:id/global-feedback/:gfbId */
globalFeedbackRouter.delete("/:gfbId", async (req, res, next) => {
  try {
    const productId = (req.params as { id: string; gfbId: string }).id;
    const gfbId = (req.params as { id: string; gfbId: string }).gfbId;
    if (!ID_RE.test(gfbId)) {
      res.status(400).json({ error: "non-conforming global feedback id" });
      return;
    }
    try {
      await deleteGlobalFeedback(productId, gfbId);
      res.json({ data: { ok: true }, version: getDataVersion() });
    } catch (e) {
      if (e instanceof GlobalFeedbackWriterError) {
        res.status(e.httpStatus).json({ error: e.message });
        return;
      }
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

