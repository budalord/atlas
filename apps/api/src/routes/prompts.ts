import { Router } from "express";
import type { GlobalFeedbackScope } from "@atlas/shared";
import { getDataVersion } from "../services/watcher";
import {
  buildFeatureRevisePrompt,
  buildEntityRevisePrompt,
  buildPrototypeRevisePrompt
} from "../services/revisePromptBuilder";
import {
  buildFeatureGeneratePrompt,
  buildEntityGeneratePrompt,
  buildConventionsGeneratePrompt,
  buildPrototypeGeneratePrompt,
  buildFlowchartGeneratePrompt,
  type GenerateScope
} from "../services/generatePromptBuilder";

export const promptsRouter = Router({ mergeParams: true });

const REVISE_SCOPES = new Set<GlobalFeedbackScope>(["feature", "entity", "prototype"]);
const GENERATE_SCOPES = new Set<GenerateScope>([
  "feature",
  "entity",
  "conventions",
  "prototype",
  "flowchart"
]);

/** GET /api/products/:id/revise-prompt?scope=feature|entity|prototype */
promptsRouter.get("/revise-prompt", async (req, res, next) => {
  try {
    const productId = (req.params as { id: string }).id;
    const scopeRaw = req.query.scope;
    const scope = typeof scopeRaw === "string" ? scopeRaw : "feature";
    if (!REVISE_SCOPES.has(scope as GlobalFeedbackScope)) {
      res.status(400).json({
        error: `scope must be one of ${Array.from(REVISE_SCOPES).join("/")}`
      });
      return;
    }
    let result;
    if (scope === "feature") result = await buildFeatureRevisePrompt(productId);
    else if (scope === "entity") result = await buildEntityRevisePrompt(productId);
    else result = await buildPrototypeRevisePrompt(productId);
    res.json({ data: result, version: getDataVersion() });
  } catch (e) {
    next(e);
  }
});

/** GET /api/products/:id/generate-prompt?scope=feature|entity|conventions|prototype */
promptsRouter.get("/generate-prompt", async (req, res, next) => {
  try {
    const productId = (req.params as { id: string }).id;
    const scopeRaw = req.query.scope;
    const scope = typeof scopeRaw === "string" ? scopeRaw : "feature";
    if (!GENERATE_SCOPES.has(scope as GenerateScope)) {
      res.status(400).json({
        error: `scope must be one of ${Array.from(GENERATE_SCOPES).join("/")}`
      });
      return;
    }
    let result;
    if (scope === "feature") result = await buildFeatureGeneratePrompt(productId);
    else if (scope === "entity") result = await buildEntityGeneratePrompt(productId);
    else if (scope === "conventions") result = await buildConventionsGeneratePrompt(productId);
    else if (scope === "flowchart") result = await buildFlowchartGeneratePrompt(productId);
    else result = await buildPrototypeGeneratePrompt(productId);
    res.json({ data: result, version: getDataVersion() });
  } catch (e) {
    next(e);
  }
});
