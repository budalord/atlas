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
 * 解析 productId 的 repo 来源(优先级):
 * 1. 环境变量 ATLAS_REPO_<PRODUCTID>(大写、非字母数字转 _)
 * 2. 本地文件 ~/.atlas/products/<id>/repo(纯文本一行 URL)—— 永不入库,适合私有 ERP 仓
 * 3. meta.repo(committed;仓库要 public 时这里通常留 null,避免把私有码仓地址入库)
 * 都没有 → null。
 */
export async function resolveRepoUrl(productId: string): Promise<string | null> {
  const envKey = `ATLAS_REPO_${productId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) return fromEnv;

  const localFile = path.join(os.homedir(), ".atlas", "products", productId, "repo");
  try {
    const txt = (await fs.readFile(localFile, "utf8")).trim();
    if (txt) return txt.split(/\r?\n/)[0].trim();
  } catch {
    /* 无本地 repo 文件 */
  }

  const meta = await loadMeta(productId);
  return meta?.repo?.trim() || null;
}

/** 根目录里这些标记 = 已有应用工程脚手架(非纯规格镜像)。 */
const SCAFFOLD_MARKERS = [
  "package.json", "pnpm-workspace.yaml", "go.mod", "pom.xml", "build.gradle",
  "Cargo.toml", "requirements.txt", "pyproject.toml", "Gemfile", "composer.json",
  "src", "app", "apps", "cmd", "internal"
];

/** 该 repo 根目录是否已搭过应用工程骨架。 */
async function hasAppCode(repoDir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(repoDir);
    const set = new Set(entries);
    return SCAFFOLD_MARKERS.some((m) => set.has(m));
  } catch {
    return false;
  }
}

export interface DevRepoInfo {
  /** meta.repo / 本地 repo 文件 / env 任一配了码仓地址 */
  configured: boolean;
  /** 本地 clone 路径(可能尚未 clone) */
  repoDir: string;
  /** 本地是否已 clone 出 git 工作树 */
  cloned: boolean;
  /** 是否已有应用工程骨架(非纯规格) */
  scaffolded: boolean;
}

/** 体检码仓状态——**不触发 clone**(给 GET 状态用)。 */
export async function inspectRepo(productId: string): Promise<DevRepoInfo> {
  const url = await resolveRepoUrl(productId);
  const repoDir = repoDirFor(productId);
  const cloned = await isGitWorkTree(repoDir);
  const scaffolded = cloned && (await hasAppCode(repoDir));
  return { configured: !!url, repoDir, cloned, scaffolded };
}

/**
 * 解析 productId 的本地码仓路径,必要时 clone。
 * - meta.repo 未配置 → 抛错(code-instruct 需要真码仓)
 * - 本地已是 git 工作树 → 直接返回
 * - 本地不存在 → git clone <repo> <dir>
 */
export async function resolveRepoDir(productId: string): Promise<string> {
  const repo = await resolveRepoUrl(productId);
  if (!repo) {
    throw new Error(
      `产品 ${productId} 未配置码仓 —— 代码任务需要真码仓。配置任一:` +
        `环境变量 ATLAS_REPO_${productId.toUpperCase().replace(/[^A-Z0-9]/g, "_")} / ` +
        `本地文件 ~/.atlas/products/${productId}/repo(一行 URL,不入库)/ meta.yml 的 repo`
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
