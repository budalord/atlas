import { promises as fs } from "node:fs";
import path from "node:path";
import { Router } from "express";
import YAML from "yaml";
import {
  intakeDiscoverPrompt,
  intakeFinalizePrompt,
  intakeInterviewPrompt,
  intakeMarkdown
} from "@atlas/shared";
import type { IntakeListItem, ProductMeta, ProductTheme } from "@atlas/shared";
import { DATA_ROOT, dataPath, listDirectories, readTextFile } from "../services/fileReader";
import { detectIntakeStage } from "../services/intake";
import { getDataVersion } from "../services/watcher";

export const intakeRouter = Router();

const ALLOWED_THEMES: ReadonlyArray<ProductTheme | "other"> = ["erp", "miniapp", "seo", "tool", "other"];
const ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

intakeRouter.post("/start", async (req, res, next) => {
  try {
    const { id, name, source_path: sourcePath, theme } = req.body ?? {};

    if (typeof id !== "string" || !ID_RE.test(id)) {
      res.status(400).json({ error: "invalid id (kebab-case lowercase only)" });
      return;
    }
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (typeof sourcePath !== "string" || !sourcePath.trim()) {
      res.status(400).json({ error: "source_path is required" });
      return;
    }
    if (typeof theme !== "string" || !ALLOWED_THEMES.includes(theme as ProductTheme)) {
      res.status(400).json({ error: "invalid theme" });
      return;
    }

    const productDir = dataPath("products", id);
    try {
      await fs.access(productDir);
      res.status(409).json({ error: `product id "${id}" already exists` });
      return;
    } catch {
      // directory doesn't exist — good
    }

    try {
      const stat = await fs.stat(sourcePath);
      if (!stat.isDirectory()) {
        res.status(400).json({ error: "source_path is not a directory" });
        return;
      }
    } catch {
      res.status(400).json({ error: "source_path does not exist" });
      return;
    }

    await fs.mkdir(productDir, { recursive: true });

    const meta: ProductMeta = {
      id,
      name,
      theme: theme as ProductTheme,
      status: "discovering",
      tech_stack: [],
      source_path: sourcePath,
      deploy_url: null,
      created_at: new Date().toISOString().slice(0, 10),
      tagline: null
    };

    await fs.writeFile(path.join(productDir, "meta.yml"), YAML.stringify(meta), "utf8");
    await fs.writeFile(path.join(productDir, "INTAKE.md"), intakeMarkdown(id), "utf8");

    const status = await detectIntakeStage(id);
    res.json({
      data: {
        id,
        name,
        theme: meta.theme,
        source_path: meta.source_path,
        created_at: meta.created_at,
        stage: status.stage
      } satisfies IntakeListItem,
      version: getDataVersion()
    });
  } catch (error) {
    next(error);
  }
});

intakeRouter.get("/list", async (_req, res, next) => {
  try {
    const ids = await listDirectories("products");
    const items: IntakeListItem[] = [];

    for (const id of ids) {
      const metaText = await readTextFile("products", id, "meta.yml");
      if (!metaText) continue;
      const meta = YAML.parse(metaText) as ProductMeta;
      if (meta.status !== "discovering") continue;
      const stage = (await detectIntakeStage(id)).stage;
      items.push({
        id,
        name: meta.name,
        theme: meta.theme,
        source_path: meta.source_path,
        created_at: meta.created_at,
        stage
      });
    }

    res.json({ data: items, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

const READABLE_FILES = new Set(["DISCOVERY.md", "INTERVIEW.md", "STATUS.md", "SUMMARY.md", "INTAKE.md", "INTAKE.archive.md"]);

intakeRouter.get("/:id/file/:name", async (req, res, next) => {
  try {
    const { id, name } = req.params;
    if (!ID_RE.test(id) || !READABLE_FILES.has(name)) {
      res.status(400).json({ error: "invalid file" });
      return;
    }
    const text = await readTextFile("products", id, name);
    if (text == null) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ data: { name, markdown: text }, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

intakeRouter.get("/:id/prompts", async (req, res, next) => {
  try {
    const metaText = await readTextFile("products", req.params.id, "meta.yml");
    if (!metaText) {
      res.status(404).json({ error: "product not found" });
      return;
    }
    const meta = YAML.parse(metaText) as ProductMeta;
    const atlasPath = path.dirname(DATA_ROOT);
    res.json({
      data: {
        discover: intakeDiscoverPrompt({
          id: meta.id,
          name: meta.name,
          sourcePath: meta.source_path,
          theme: meta.theme,
          atlasPath
        }),
        interview: intakeInterviewPrompt({ id: meta.id, atlasPath }),
        finalize: intakeFinalizePrompt({ id: meta.id, atlasPath })
      },
      version: getDataVersion()
    });
  } catch (error) {
    next(error);
  }
});

intakeRouter.get("/:id/stage", async (req, res, next) => {
  try {
    const metaText = await readTextFile("products", req.params.id, "meta.yml");
    if (!metaText) {
      res.status(404).json({ error: "product not found" });
      return;
    }
    const meta = YAML.parse(metaText) as ProductMeta;
    const status = await detectIntakeStage(req.params.id);
    res.json({
      data: {
        ...status,
        info: {
          id: meta.id,
          name: meta.name,
          theme: meta.theme,
          source_path: meta.source_path,
          created_at: meta.created_at,
          status: meta.status
        }
      },
      version: getDataVersion()
    });
  } catch (error) {
    next(error);
  }
});

intakeRouter.post("/:id/complete", async (req, res, next) => {
  try {
    const productDir = dataPath("products", req.params.id);
    const intakeFile = path.join(productDir, "INTAKE.md");
    const archivedFile = path.join(productDir, "INTAKE.archive.md");
    const metaFile = path.join(productDir, "meta.yml");

    try {
      await fs.access(intakeFile);
      await fs.rename(intakeFile, archivedFile);
    } catch {
      // already archived or never existed — non-fatal
    }

    const metaText = await readTextFile("products", req.params.id, "meta.yml");
    if (!metaText) {
      res.status(404).json({ error: "product not found" });
      return;
    }
    const meta = YAML.parse(metaText) as ProductMeta;
    if (meta.status === "discovering") {
      meta.status = "in-progress";
      await fs.writeFile(metaFile, YAML.stringify(meta), "utf8");
    }

    const status = await detectIntakeStage(req.params.id);
    res.json({ data: { meta, stage: status.stage }, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});
