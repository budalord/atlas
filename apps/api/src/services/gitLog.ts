import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { GitCommit } from "@atlas/shared";

const exec = promisify(execFile);

const HASH_PATTERN = /^[0-9a-f]{7,40}$/i;

/**
 * 校验路径下是否有 .git 目录,失败返回 null。
 * 不抛错(在调用方便于"无 git → 空数组"的优雅处理)。
 */
export async function ensureGitRepo(repoPath: string): Promise<string | null> {
  if (!repoPath) return null;
  try {
    await access(path.join(repoPath, ".git"));
    return repoPath;
  } catch {
    return null;
  }
}

/**
 * 读取最近 N 条 commit。
 * 用 \x1f 做字段分隔(单元分隔符)、\x1e 做行分隔(记录分隔符),避免 commit subject 中
 * 的换行 / 制表符干扰。limit 上限 200。
 */
export async function readRecentCommits(repoPath: string, limit: number): Promise<GitCommit[]> {
  const safePath = await ensureGitRepo(repoPath);
  if (!safePath) return [];
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit) || 20));
  const fmt = "%H%x1f%h%x1f%aI%x1f%an%x1f%s%x1e";
  try {
    const { stdout } = await exec("git", ["log", `-${safeLimit}`, `--pretty=format:${fmt}`], {
      cwd: safePath,
      maxBuffer: 4 * 1024 * 1024
    });
    return stdout
      .split("\x1e")
      .map((row) => row.replace(/^\n/, ""))
      .filter((row) => row.length > 0)
      .map((row) => {
        const [hash, shortHash, date, author, subject] = row.split("\x1f");
        return { hash, shortHash, date, author, subject } satisfies GitCommit;
      });
  } catch {
    // 仓库存在但 git log 出错(空仓库等),返回空列表
    return [];
  }
}

/**
 * 读取单个 commit 的 stat + diff。hash 必须 7-40 位 hex。
 */
export async function readCommitDiff(repoPath: string, hash: string): Promise<string | null> {
  if (!HASH_PATTERN.test(hash)) return null;
  const safePath = await ensureGitRepo(repoPath);
  if (!safePath) return null;
  try {
    const { stdout } = await exec("git", ["show", "--stat", "--patch", "--no-color", hash], {
      cwd: safePath,
      maxBuffer: 8 * 1024 * 1024
    });
    return stdout;
  } catch {
    return null;
  }
}
