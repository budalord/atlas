import { Router } from "express";
import { listMarkdownFiles, readTextFile } from "../services/fileReader";
import { parseContractMarkdown } from "../services/markdownParser";
import { getDataVersion } from "../services/watcher";

export const contractsRouter = Router();

contractsRouter.get("/", async (_req, res, next) => {
  try {
    const files = await listMarkdownFiles("contracts");
    const contracts = await Promise.all(
      files.map(async (file) => {
        const source = await readTextFile("contracts", file);
        return source ? parseContractMarkdown(file.replace(/\.md$/, ""), source) : null;
      })
    );

    res.json({
      data: contracts.filter(Boolean),
      version: getDataVersion()
    });
  } catch (error) {
    next(error);
  }
});
