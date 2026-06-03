import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "./gitChangeset";

/**
 * 改造 3:每个 code-instruct Task 一个 git worktree 隔离目录,支持同仓多 Task 并行(各自工作树,
 * 互不写冲突)。worktree 与主 clone 共享 .git,但有独立工作树和独立分支 atlas/<taskId>。
 *
 * 生命周期:run 前 createWorktree(从主 clone 当前 HEAD 切分支)→ codex 在 worktree 内改 →
 * approve 时在 worktree 提交并合并回主线 → 终态(approve/reject/fail/no-change)removeWorktree 清理。
 */

const WORKTREES_ROOT = path.join(os.homedir(), ".atlas", "worktrees");

export interface WorktreeHandle {
  worktreePath: string;
  branch: string;
}

function branchName(taskId: string): string {
  return `atlas/${taskId}`;
}

/** 从主 clone 当前 HEAD 新建 worktree + 分支。已存在则先清理重建。 */
export async function createWorktree(repoDir: string, taskId: string): Promise<WorktreeHandle> {
  const worktreePath = path.join(WORKTREES_ROOT, taskId);
  const branch = branchName(taskId);
  // 清理可能的残留(同 taskId 重试)
  await removeWorktree(repoDir, taskId, worktreePath, branch).catch(() => undefined);
  await fs.mkdir(WORKTREES_ROOT, { recursive: true });
  // -B:分支已存在则重置;基于主 clone 当前 HEAD
  await git(["worktree", "add", "-B", branch, worktreePath, "HEAD"], repoDir);
  return { worktreePath, branch };
}

/** 移除 worktree 目录 + 删除其分支。幂等,best-effort。 */
export async function removeWorktree(
  repoDir: string,
  _taskId: string,
  worktreePath: string,
  branch: string
): Promise<void> {
  await git(["worktree", "remove", "--force", worktreePath], repoDir, true).catch(() => undefined);
  // worktree remove 后目录若仍在(异常),强删
  await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
  await git(["worktree", "prune"], repoDir, true).catch(() => undefined);
  await git(["branch", "-D", branch], repoDir, true).catch(() => undefined);
}

/**
 * approve:把 worktree 分支合并回主 clone 的当前分支(主线)。
 * worktree 内已 commit(gitApprove),这里在主 clone 做合并。冲突则抛错(人工解决)。
 * 主 clone 的工作树在 worktree 模式下始终干净(任务都在 worktree 里跑),合并安全。
 */
export async function mergeWorktreeToMain(repoDir: string, branch: string): Promise<void> {
  const res = await git(["merge", "--no-ff", "-m", `Atlas merge ${branch}`, branch], repoDir, true);
  if (res.code !== 0) {
    // 合并失败(多半冲突)→ 中止合并,抛错让上层报告
    await git(["merge", "--abort"], repoDir, true).catch(() => undefined);
    throw new Error(`合并 ${branch} 回主线失败(可能冲突): ${res.stderr || res.stdout}`);
  }
}
