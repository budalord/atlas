import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ChangedFile } from "@atlas/shared";

/**
 * 应用代码层(code-instruct)的 git-aware 变更追踪。
 *
 * 与 changesetTracker.ts(规格 md + .atlas-staging snapshot)并列、互不干扰:
 * - 规格层:.md mtime+content snapshot,reject 从 .atlas-staging 回滚
 * - 代码层:真码仓里 codex workspace-write 直接改文件,用 git diff 反推 changedFiles,
 *   reject = `git reset --hard HEAD && git clean -fd`,approve = `git commit`
 *
 * 形状与 changesetTracker 一致(ChangedFile[]),所以三态闸 / ReviewChangesetModal 零改动复用。
 */

const GIT_MAXBUFFER = 64 * 1024 * 1024;

/** 跑一条 git 命令。allowFail=true 时不抛错,返回 code !== 0。 */
export function git(
  args: string[],
  cwd: string,
  allowFail = false
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      { maxBuffer: GIT_MAXBUFFER, encoding: "utf8" },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : err ? 1 : 0;
        if (err && !allowFail) {
          reject(new Error(`git ${args.join(" ")} failed (code ${code}): ${stderr || err.message}`));
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code });
      }
    );
  });
}

/** 把工作树重置到干净的 HEAD(丢弃所有未提交改动 + 未跟踪文件)。 */
export async function gitEnsureClean(repoDir: string): Promise<void> {
  await git(["reset", "--hard", "HEAD"], repoDir);
  await git(["clean", "-fd"], repoDir);
}

/** 该路径在工作树里是否二进制(含 NUL 字节)。读不到按非二进制处理。 */
async function isBinary(abs: string): Promise<boolean> {
  try {
    const buf = await fs.readFile(abs);
    return buf.includes(0);
  } catch {
    return false;
  }
}

/**
 * 把 codex 在 repoDir 里造成的工作树改动反推成 ChangedFile[]。
 * 先 `git add -A` 暂存(approve 时直接 commit),再用 `git diff --cached` 列变更。
 * - A → create(before=null) · D → delete(after=null) · 其他 → update
 * - 二进制文件 before/after 置 null(只显示动作,不塞内容)
 */
export async function gitDiffChangedFiles(repoDir: string): Promise<ChangedFile[]> {
  await git(["add", "-A"], repoDir);
  // --no-renames:让重命名显示为 D+A,简化解析(不必处理 Rxxx old new 三元组)
  const { stdout } = await git(["diff", "--cached", "--name-status", "--no-renames", "-z"], repoDir);
  const parts = stdout.split("\0").filter((p) => p.length > 0);
  const out: ChangedFile[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i].trim();
    const rel = parts[i + 1];
    const action: ChangedFile["action"] =
      status.startsWith("A") ? "create" : status.startsWith("D") ? "delete" : "update";

    const abs = path.join(repoDir, rel);
    const binary = action === "delete" ? false : await isBinary(abs);

    let before: string | null = null;
    if (action !== "create") {
      const res = await git(["show", `HEAD:${rel}`], repoDir, true);
      before = res.code === 0 && !looksBinary(res.stdout) ? res.stdout : null;
    }
    let after: string | null = null;
    if (action !== "delete" && !binary) {
      after = await fs.readFile(abs, "utf8").catch(() => null);
    }
    out.push({ path: rel, action, before: binary ? null : before, after });
  }
  return out;
}

/** 内容(来自 git show)是否疑似二进制(含 NUL)。 */
function looksBinary(s: string): boolean {
  return s.includes("\0");
}

/** reject:丢弃本 task 在工作树里的全部改动,回到干净 HEAD。 */
export async function gitReject(repoDir: string): Promise<void> {
  await gitEnsureClean(repoDir);
}

/** approve:把已暂存的改动提交到当前分支(落地)。无暂存内容则跳过。 */
export async function gitApprove(repoDir: string, message: string): Promise<void> {
  await git(["add", "-A"], repoDir);
  const staged = await git(["diff", "--cached", "--quiet"], repoDir, true);
  if (staged.code === 0) return; // 无暂存改动,无需 commit
  // 提交人用本地 git config;无则给一个 Atlas 默认 author,避免 commit 失败
  await git(
    ["-c", "user.name=Atlas Agent", "-c", "user.email=atlas@local", "commit", "-m", message, "--no-verify"],
    repoDir
  );
}
