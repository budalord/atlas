import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../../");

export const specRouter = Router();

specRouter.get("/atlas", async (_req, res, next) => {
  try {
    const buf = await fs.readFile(path.join(repoRoot, "ATLAS-SPEC.md"), "utf8");
    res.type("text/plain; charset=utf-8").send(buf);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      res.status(404).json({ error: "ATLAS-SPEC.md not found at repo root" });
      return;
    }
    next(error);
  }
});
