import { Router } from "express";
import { getDataVersion } from "../services/watcher";
import {
  buildActorRevisePrompt,
  buildFeatureRevisePrompt,
  buildEntityRevisePrompt,
  buildPrototypeRevisePrompt,
  buildScreenRevisePrompt,
  buildUseCaseRevisePrompt
} from "../services/revisePromptBuilder";
import {
  buildFeatureGeneratePrompt,
  buildEntityGeneratePrompt,
  buildEntityDerivePrompt,
  buildConventionsGeneratePrompt,
  buildPrototypeGeneratePrompt,
  buildScreenGeneratePrompt,
  type GenerateScope
} from "../services/generatePromptBuilder";

export const promptsRouter = Router({ mergeParams: true });

type ReviseScope = "feature" | "entity" | "prototype" | "actor" | "usecase" | "screen";
const REVISE_SCOPES = new Set<ReviseScope>([
  "feature",
  "entity",
  "prototype",
  "actor",
  "usecase",
  "screen"
]);
const GENERATE_SCOPES = new Set<GenerateScope>([
  "feature",
  "entity",
  "entity-derive",
  "conventions",
  "prototype",
  "screen"
]);

/** GET /api/products/:id/revise-prompt?scope=feature|entity|prototype */
promptsRouter.get("/revise-prompt", async (req, res, next) => {
  try {
    const productId = (req.params as { id: string }).id;
    const scopeRaw = req.query.scope;
    const scope = typeof scopeRaw === "string" ? scopeRaw : "feature";
    if (!REVISE_SCOPES.has(scope as ReviseScope)) {
      res.status(400).json({
        error: `scope must be one of ${Array.from(REVISE_SCOPES).join("/")}`
      });
      return;
    }
    let result;
    if (scope === "feature") result = await buildFeatureRevisePrompt(productId);
    else if (scope === "entity") result = await buildEntityRevisePrompt(productId);
    else if (scope === "actor") result = await buildActorRevisePrompt(productId);
    else if (scope === "usecase") result = await buildUseCaseRevisePrompt(productId);
    else if (scope === "screen") result = await buildScreenRevisePrompt(productId);
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
    else if (scope === "entity-derive") result = await buildEntityDerivePrompt(productId);
    else if (scope === "conventions") result = await buildConventionsGeneratePrompt(productId);
    else if (scope === "screen") result = await buildScreenGeneratePrompt(productId);
    else result = await buildPrototypeGeneratePrompt(productId);
    res.json({ data: result, version: getDataVersion() });
  } catch (e) {
    next(e);
  }
});
