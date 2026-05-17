import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DesignDoc, DesignSummary } from "@atlas/shared";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../../");

function designsDir(productId: string): string {
  return path.join(repoRoot, "data", "designs", productId);
}

function designFile(productId: string, name: string): string {
  return path.join(designsDir(productId), `${name}.md`);
}

const NAME_RE = /^[a-z][a-z0-9_-]*$/i;

export function isValidDesignName(name: string): boolean {
  return NAME_RE.test(name);
}

export async function listDesigns(productId: string): Promise<DesignSummary[]> {
  const dir = designsDir(productId);
  try {
    const files = await fs.readdir(dir, { withFileTypes: true });
    const out: DesignSummary[] = [];
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith(".md")) continue;
      const stat = await fs.stat(path.join(dir, f.name));
      out.push({
        name: f.name.replace(/\.md$/, ""),
        last_modified: stat.mtime.toISOString()
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

export async function loadDesign(
  productId: string,
  name: string
): Promise<DesignDoc | null> {
  try {
    const file = designFile(productId, name);
    const [body, stat] = await Promise.all([
      fs.readFile(file, "utf8"),
      fs.stat(file)
    ]);
    return { name, body, last_modified: stat.mtime.toISOString() };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function writeDesign(
  productId: string,
  name: string,
  body: string,
  options: { mustNotExist?: boolean } = {}
): Promise<DesignDoc> {
  const dir = designsDir(productId);
  await fs.mkdir(dir, { recursive: true });
  const file = designFile(productId, name);
  if (options.mustNotExist) {
    try {
      await fs.access(file);
      throw new DesignConflictError(`Design ${name} already exists`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  await fs.writeFile(file, body, "utf8");
  const stat = await fs.stat(file);
  return { name, body, last_modified: stat.mtime.toISOString() };
}

export async function deleteDesign(productId: string, name: string): Promise<boolean> {
  const file = designFile(productId, name);
  try {
    await fs.unlink(file);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

export class DesignConflictError extends Error {}

export function designTemplate(name: string, featureName?: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `# ${featureName ?? name} · 设计页

## 用途
一句话描述这个页面/功能要解决什么问题。

## 主流程
1. ...

## 界面元素
- ...

## 状态/边界
- ...

## 设计决策
- (${today}) ...
`;
}
