import { Router, Request } from "express";
import {
  DesignConflictError,
  deleteDesign,
  designTemplate,
  isValidDesignName,
  listDesigns,
  loadDesign,
  writeDesign
} from "../services/designLoader";
import { getDataVersion } from "../services/watcher";

type ProductReq = Request<{ id: string }>;
type DesignReq = Request<{ id: string; name: string }>;

export const designsRouter = Router({ mergeParams: true });

// GET /api/products/:id/designs
designsRouter.get("/", async (req: ProductReq, res, next) => {
  try {
    const list = await listDesigns(req.params.id);
    res.json({ data: list, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

// GET /api/products/:id/designs/:name
designsRouter.get("/:name", async (req: DesignReq, res, next) => {
  try {
    if (!isValidDesignName(req.params.name)) {
      res.status(400).json({ error: "invalid design name" });
      return;
    }
    const doc = await loadDesign(req.params.id, req.params.name);
    if (!doc) {
      res.status(404).json({ error: "Design not found" });
      return;
    }
    res.json({ data: doc, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

// POST /api/products/:id/designs   body { name, body?, featureName? }
designsRouter.post("/", async (req: ProductReq, res, next) => {
  try {
    const { name, body, featureName } = req.body ?? {};
    if (typeof name !== "string" || !isValidDesignName(name)) {
      res.status(400).json({ error: "name required (letters/digits/-/_, starts with letter)" });
      return;
    }
    const content =
      typeof body === "string" && body.trim().length > 0
        ? body
        : designTemplate(name, typeof featureName === "string" ? featureName : undefined);
    try {
      const doc = await writeDesign(req.params.id, name, content, { mustNotExist: true });
      res.status(201).json({ data: doc, version: getDataVersion() });
    } catch (e) {
      if (e instanceof DesignConflictError) {
        res.status(409).json({ error: e.message });
        return;
      }
      throw e;
    }
  } catch (error) {
    next(error);
  }
});

// PUT /api/products/:id/designs/:name   body { body }
designsRouter.put("/:name", async (req: DesignReq, res, next) => {
  try {
    if (!isValidDesignName(req.params.name)) {
      res.status(400).json({ error: "invalid design name" });
      return;
    }
    const body = req.body?.body;
    if (typeof body !== "string") {
      res.status(400).json({ error: "body (string) required" });
      return;
    }
    const existing = await loadDesign(req.params.id, req.params.name);
    if (!existing) {
      res.status(404).json({ error: "Design not found" });
      return;
    }
    const doc = await writeDesign(req.params.id, req.params.name, body);
    res.json({ data: doc, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/products/:id/designs/:name
designsRouter.delete("/:name", async (req: DesignReq, res, next) => {
  try {
    if (!isValidDesignName(req.params.name)) {
      res.status(400).json({ error: "invalid design name" });
      return;
    }
    const ok = await deleteDesign(req.params.id, req.params.name);
    if (!ok) {
      res.status(404).json({ error: "Design not found" });
      return;
    }
    res.json({ data: { name: req.params.name }, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});
