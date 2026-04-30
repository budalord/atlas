import { Router } from "express";
import { getFileMtime, readTextFile } from "../services/fileReader";
import { getDataVersion } from "../services/watcher";

export const agentsRouter = Router();

agentsRouter.get("/claude", async (_req, res, next) => {
  try {
    const markdown = await readTextFile("agents", "CLAUDE.md");
    const updatedAt = await getFileMtime("agents", "CLAUDE.md");

    res.json({
      data: {
        markdown: markdown ?? "",
        updated_at: updatedAt
      },
      version: getDataVersion()
    });
  } catch (error) {
    next(error);
  }
});

// TODO: Future Agent Inbox endpoints belong here.
