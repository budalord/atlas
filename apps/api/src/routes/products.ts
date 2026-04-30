import { Router } from "express";
import type { Product } from "@atlas/shared";
import { listDirectories, readTextFile } from "../services/fileReader";
import { getDataVersion } from "../services/watcher";
import { normalizeProductMeta, parseStatusMarkdown, parseYaml } from "../services/markdownParser";

export const productsRouter = Router();

productsRouter.get("/", async (_req, res, next) => {
  try {
    const products = await readProducts();
    res.json({ data: products, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

productsRouter.get("/:id", async (req, res, next) => {
  try {
    const product = await readProduct(req.params.id);
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    res.json({ data: product, version: getDataVersion() });
  } catch (error) {
    next(error);
  }
});

async function readProducts(): Promise<Product[]> {
  const ids = await listDirectories("products");
  const products = await Promise.all(ids.map((id) => readProduct(id)));
  return products
    .filter((product): product is Product => Boolean(product))
    .filter((product) => product.meta.status !== "discovering");
}

async function readProduct(id: string): Promise<Product | null> {
  const metaSource = await readTextFile("products", id, "meta.yml");
  const statusSource = await readTextFile("products", id, "STATUS.md");

  if (!metaSource || !statusSource) {
    return null;
  }

  const meta = normalizeProductMeta(parseYaml(metaSource));
  const status = parseStatusMarkdown(statusSource);

  return {
    id,
    meta,
    last_updated: status.last_updated,
    summary: status.summary,
    todos: status.todos,
    blockers: status.blockers,
    features: status.features,
    statusMarkdown: status.body
  };
}
