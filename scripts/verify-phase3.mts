/**
 * Phase 3 验收(worktree 并行隔离,不依赖 codex):
 * 两个 Task 各开 worktree → 各改各的文件 → gitDiff 互相看不到对方(隔离)→
 * approve A(commit+合并回主线)/ reject B(丢弃 worktree)→ 主线只有 A 的改动。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveRepoDir } from "../apps/api/src/services/repoResolver";
import { git, gitDiffChangedFiles, gitApprove } from "../apps/api/src/services/gitChangeset";
import { createWorktree, removeWorktree, mergeWorktreeToMain } from "../apps/api/src/services/worktreeManager";

function assert(c: unknown, m: string) { if (!c) throw new Error("ASSERT FAILED: " + m); }

async function main() {
  const repo = await resolveRepoDir("yunkai-erp");
  await git(["reset", "--hard", "origin/main"], repo);
  await git(["clean", "-fd"], repo);
  await git(["worktree", "prune"], repo);
  const head0 = (await git(["rev-parse", "HEAD"], repo)).stdout.trim();
  console.log("✓ repo baseline", head0.slice(0, 8));

  // 两个并行 Task 各开 worktree
  const A = await createWorktree(repo, "verifyA");
  const B = await createWorktree(repo, "verifyB");
  console.log("✓ 两 worktree:", path.basename(A.worktreePath), "/", path.basename(B.worktreePath));

  // 各改各的文件(模拟并行 agent)
  await fs.writeFile(path.join(A.worktreePath, "phase3_A.txt"), "from task A\n");
  await fs.writeFile(path.join(B.worktreePath, "phase3_B.txt"), "from task B\n");

  const cfA = await gitDiffChangedFiles(A.worktreePath);
  const cfB = await gitDiffChangedFiles(B.worktreePath);
  console.log("  A sees:", cfA.map((f) => f.path), "| B sees:", cfB.map((f) => f.path));
  // 隔离:A 只看到自己的,B 只看到自己的
  assert(cfA.length === 1 && cfA[0].path === "phase3_A.txt", "A 工作树只含 A 改动");
  assert(cfB.length === 1 && cfB[0].path === "phase3_B.txt", "B 工作树只含 B 改动");
  console.log("✓ 并行隔离:两 worktree 改动互不可见");

  // approve A:worktree 提交 + 合并回主线
  await gitApprove(A.worktreePath, "Atlas verify A");
  await mergeWorktreeToMain(repo, A.branch);
  await removeWorktree(repo, "verifyA", A.worktreePath, A.branch);
  // reject B:丢弃 worktree
  await removeWorktree(repo, "verifyB", B.worktreePath, B.branch);
  console.log("✓ approve A(合并)/ reject B(丢弃)");

  // 主线应只有 A 的文件,无 B 的;HEAD 前进
  const head1 = (await git(["rev-parse", "HEAD"], repo)).stdout.trim();
  assert(head1 !== head0, "approve A 后主线 HEAD 应前进");
  const hasA = (await git(["cat-file", "-e", "HEAD:phase3_A.txt"], repo, true)).code === 0;
  const hasB = (await git(["cat-file", "-e", "HEAD:phase3_B.txt"], repo, true)).code === 0;
  assert(hasA, "主线应含 A 的文件");
  assert(!hasB, "主线不应含 B 的文件(已 reject)");
  console.log("✓ 主线只含 A 改动,不含 B");

  // worktree 都已清理
  const wl = (await git(["worktree", "list"], repo)).stdout;
  assert(!wl.includes("verifyA") && !wl.includes("verifyB"), "worktree 应已清理");
  console.log("✓ worktree 已清理");

  // cleanup:回到原始 baseline
  await git(["reset", "--hard", head0], repo);
  await git(["clean", "-fd"], repo);
  console.log("✓ cleanup → 回到", head0.slice(0, 8));
  console.log("\nPHASE 3 WORKTREE 并行隔离: ALL GOOD ✅");
}

main().catch((e) => { console.error("\nPHASE 3 VERIFY FAILED ❌\n", e); process.exit(1); });
