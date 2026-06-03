import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProductMeta } from "@atlas/shared";
import { normalizeProductMeta, parseYaml } from "./markdownParser";
import { readTextFile } from "./fileReader";
import { git } from "./gitChangeset";

/**
 * 真码仓解析:meta.repo → 本地 clone 工作目录(~/.atlas/repos/<productId>)。
 * 缺失则用已登录的 git 凭据 clone。返回干净工作树的绝对路径。
 *
 * code-instruct 任务的 cwd 指向这里(而非规格目录 data/products/<id>)。
 */

/** 本地 clone 根目录:~/.atlas/repos/<productId> */
export function repoDirFor(productId: string): string {
  return path.join(os.homedir(), ".atlas", "repos", productId);
}

async function loadMeta(productId: string): Promise<ProductMeta | null> {
  const src = await readTextFile("products", productId, "meta.yml");
  if (!src) return null;
  try {
    return normalizeProductMeta(parseYaml(src));
  } catch {
    return null;
  }
}

/** 把 meta.repo(可能是 "owner/name" 或完整 URL)规整成可 clone 的 URL。 */
export function normalizeRepoUrl(repo: string): string {
  const r = repo.trim();
  if (/^(https?:\/\/|git@)/.test(r)) return r;
  // "owner/name" → GitHub https
  if (/^[\w.-]+\/[\w.-]+$/.test(r)) return `https://github.com/${r}`;
  return r;
}

async function isGitWorkTree(dir: string): Promise<boolean> {
  try {
    const res = await git(["rev-parse", "--is-inside-work-tree"], dir, true);
    return res.code === 0 && res.stdout.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * 解析 productId 的本地码仓路径,必要时 clone。
 * - meta.repo 未配置 → 抛错(code-instruct 需要真码仓)
 * - 本地已是 git 工作树 → 直接返回
 * - 本地不存在 → git clone <repo> <dir>
 */
export async function resolveRepoDir(productId: string): Promise<string> {
  const meta = await loadMeta(productId);
  const repo = meta?.repo?.trim();
  if (!repo) {
    throw new Error(
      `产品 ${productId} 未配置 meta.repo —— 代码任务需要真码仓,请在 meta.yml 填 repo: <owner/name 或 URL>`
    );
  }
  const dir = repoDirFor(productId);

  if (await isGitWorkTree(dir)) return dir;

  // 目录存在但不是 git 工作树(残留/损坏)→ 清掉重 clone
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(path.dirname(dir), { recursive: true });
  const url = normalizeRepoUrl(repo);
  // clone 到 dir;用进程已有的 git 凭据(gh / keychain)
  await git(["clone", url, dir], path.dirname(dir));
  if (!(await isGitWorkTree(dir))) {
    throw new Error(`clone 后 ${dir} 仍不是 git 工作树(检查 ${url} 与凭据)`);
  }
  return dir;
}
