import { Router } from "express";
import { readTextFile } from "../services/fileReader";
import { ensureGitRepo, readCommitDiff, readRecentCommits } from "../services/gitLog";
import { readGitHubSummary } from "../services/github";
import { normalizeProductMeta, parseYaml } from "../services/markdownParser";
import type { ProductMeta } from "@atlas/shared";

export const gitRouter = Router();

/** GET /api/products/:id/commits?limit=20 */
gitRouter.get("/products/:id/commits", async (req, res, next) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const limit = Number.parseInt(String(req.query.limit ?? "20"), 10);
    const repoExists = !!(await ensureGitRepo(meta.source_path));
    const commits = await readRecentCommits(meta.source_path, limit);
    res.json({
      data: commits,
      sourcePath: meta.source_path,
      repoAvailable: repoExists
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/products/:id/commits/:hash — 返回 stat + diff 文本 */
gitRouter.get("/products/:id/commits/:hash", async (req, res, next) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const diff = await readCommitDiff(meta.source_path, req.params.hash);
    if (diff === null) {
      res.status(404).json({ error: "Commit not found or invalid hash" });
      return;
    }
    res.json({ data: diff });
  } catch (error) {
    next(error);
  }
});

/** GET /api/products/:id/github — 默认分支 + PR + Issue */
gitRouter.get("/products/:id/github", async (req, res, next) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const summary = await readGitHubSummary(meta.repo);
    res.json({ data: summary });
  } catch (error) {
    next(error);
  }
});

async function loadMeta(id: string): Promise<ProductMeta | null> {
  try {
    const raw = await readTextFile("products", id, "meta.yml");
    if (!raw) return null;
    const parsed = parseYaml<ProductMeta>(raw);
    return normalizeProductMeta(parsed);
  } catch {
    return null;
  }
}
