import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../../");

export const DATA_ROOT = process.env.ATLAS_DATA_DIR
  ? path.resolve(process.env.ATLAS_DATA_DIR)
  : path.join(repoRoot, "data");

export function dataPath(...segments: string[]) {
  return path.join(DATA_ROOT, ...segments);
}

export async function readTextFile(...segments: string[]) {
  try {
    return await fs.readFile(dataPath(...segments), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function listDirectories(...segments: string[]) {
  const entries = await fs.readdir(dataPath(...segments), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export async function listMarkdownFiles(...segments: string[]) {
  const entries = await fs.readdir(dataPath(...segments), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
}

export async function getFileMtime(...segments: string[]) {
  try {
    const stat = await fs.stat(dataPath(...segments));
    return stat.mtime.toISOString();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * 检查 data 路径下文件/目录是否存在(不区分类型, 仅判可访问)。
 */
export async function pathExists(...segments: string[]): Promise<boolean> {
  try {
    await fs.access(dataPath(...segments));
    return true;
  } catch {
    return false;
  }
}
