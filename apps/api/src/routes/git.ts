import { Router } from "express";
import { readTextFile } from "../services/fileReader";
import { ensureGitRepo, readCommitDiff, readRecentCommits } from "../services/gitLog";
import { createIssue, GitHubIssueError, readGitHubSummary } from "../services/github";
import { normalizeProductMeta, parseYaml } from "../services/markdownParser";
import type { ProductMeta, ProductStatus } from "@atlas/shared";

export const gitRouter = Router();

/**
 * 立项阶段(discovering / planning)产品不挂 git:源代码还没起,GitHub 数据无意义。
 * 已上线/进行中/暂停/归档:挂 git。
 */
const GIT_DISABLED_STATUSES: ProductStatus[] = ["discovering", "planning"];

function gitEnabledForStatus(status: ProductStatus): boolean {
  return !GIT_DISABLED_STATUSES.includes(status);
}

/** GET /api/products/:id/commits?limit=20 */
gitRouter.get("/products/:id/commits", async (req, res, next) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    if (!gitEnabledForStatus(meta.status)) {
      res.json({ data: [], sourcePath: null, repoAvailable: false });
      return;
    }
    const limit = Number.parseInt(String(req.query.limit ?? "20"), 10);
    if (!meta.source_path) {
      res.json({ data: [], sourcePath: null, repoAvailable: false });
      return;
    }
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
    if (!gitEnabledForStatus(meta.status)) {
      res.status(403).json({ error: "立项阶段不挂 git;切到进行中后启用" });
      return;
    }
    if (!meta.source_path) {
      res.status(404).json({ error: "Product has no source repository" });
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
    if (!gitEnabledForStatus(meta.status)) {
      res.json({ data: { repo: null, prs: [], issues: [] } });
      return;
    }
    const summary = await readGitHubSummary(meta.repo);
    res.json({ data: summary });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/products/:id/issues — body { title, body, labels? }
 * 调 `gh issue create -R <repo>` 在 GitHub 创建 issue。
 * meta.repo 未配 → 400;gh CLI 不可用 → 503;其他 gh 错误 → 502。
 */
gitRouter.post("/products/:id/issues", async (req, res, next) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    if (!gitEnabledForStatus(meta.status)) {
      res.status(403).json({ error: "立项阶段不允许创建 GitHub issue;切到进行中后启用" });
      return;
    }
    const { title, body, labels } = req.body ?? {};
    if (typeof title !== "string" || !title.trim()) {
      res.status(400).json({ error: "title required" });
      return;
    }
    if (typeof body !== "string") {
      res.status(400).json({ error: "body (string) required" });
      return;
    }
    const labelsArr: string[] | undefined = Array.isArray(labels)
      ? labels.filter((l): l is string => typeof l === "string" && l.trim().length > 0)
      : undefined;
    try {
      const result = await createIssue(meta.repo, { title: title.trim(), body, labels: labelsArr });
      res.status(201).json({ data: result });
    } catch (e) {
      if (e instanceof GitHubIssueError) {
        const status = e.code === "no-repo" ? 400 : e.code === "gh-missing" ? 503 : 502;
        res.status(status).json({ error: e.message, code: e.code });
        return;
      }
      throw e;
    }
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
