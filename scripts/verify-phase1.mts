/**
 * Phase 1 验收(git-aware 代码通道,不依赖 codex):
 * resolveRepoDir clone → 模拟 agent 改代码 → gitDiffChangedFiles → reject 回滚 / approve 提交。
 * 跑完把 clone 重置回原始 HEAD,保持 pristine。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveRepoDir } from "../apps/api/src/services/repoResolver";
import { git, gitDiffChangedFiles, gitReject, gitApprove, gitEnsureClean } from "../apps/api/src/services/gitChangeset";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
}

async function main() {
  const repo = await resolveRepoDir("yunkai-erp");
  console.log("✓ resolveRepoDir →", repo);

  await gitEnsureClean(repo);
  const head0 = (await git(["rev-parse", "HEAD"], repo)).stdout.trim();
  console.log("  baseline HEAD:", head0.slice(0, 8));

  // —— 模拟 agent 改代码:新建源文件 + 改 README ——
  await fs.writeFile(path.join(repo, "atlas-verify.txt"), "hello from atlas phase1 verify\n");
  const readme = path.join(repo, "README.md");
  const orig = await fs.readFile(readme, "utf8").catch(() => "");
  await fs.writeFile(readme, orig + "\n<!-- atlas verify edit -->\n");

  const cf = await gitDiffChangedFiles(repo);
  console.log("✓ gitDiffChangedFiles →", cf.map((f) => `${f.action}:${f.path}`).join(", "));
  const created = cf.find((f) => f.path === "atlas-verify.txt");
  const updated = cf.find((f) => f.path === "README.md");
  assert(created && created.action === "create" && created.before === null && created.after?.includes("phase1 verify"), "create 文件 before=null/after 有内容");
  assert(updated && updated.action === "update" && updated.before !== null && updated.after?.includes("atlas verify edit"), "update 文件 before/after 都在");

  // —— reject:工作树回到干净 HEAD ——
  await gitReject(repo);
  const dirtyA = (await git(["status", "--porcelain"], repo)).stdout.trim();
  assert(dirtyA === "", "reject 后工作树应干净, 实际: " + dirtyA);
  const headAfterReject = (await git(["rev-parse", "HEAD"], repo)).stdout.trim();
  assert(headAfterReject === head0, "reject 不应移动 HEAD");
  console.log("✓ reject → 工作树干净, HEAD 不动");

  // —— 再改一次 + approve:提交落地 ——
  await fs.writeFile(path.join(repo, "atlas-verify.txt"), "second pass\n");
  await gitDiffChangedFiles(repo); // stage
  await gitApprove(repo, "Atlas verify commit (phase1)");
  const head1 = (await git(["rev-parse", "HEAD"], repo)).stdout.trim();
  assert(head1 !== head0, "approve 应产生新 commit");
  const dirtyB = (await git(["status", "--porcelain"], repo)).stdout.trim();
  assert(dirtyB === "", "approve 后工作树应干净");
  console.log("✓ approve → 提交落地", head0.slice(0, 8), "→", head1.slice(0, 8));

  // —— cleanup:把 clone 重置回原始 HEAD,保持 pristine ——
  await git(["reset", "--hard", head0], repo);
  await git(["clean", "-fd"], repo);
  console.log("✓ cleanup → 重置回", head0.slice(0, 8));

  console.log("\nPHASE 1 GIT-AWARE 通道: ALL GOOD ✅");
}

main().catch((e) => {
  console.error("\nPHASE 1 VERIFY FAILED ❌\n", e);
  process.exit(1);
});
