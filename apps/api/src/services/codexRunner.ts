import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ChangedFile } from "@atlas/shared";
import {
  snapshotProductFiles,
  diffSnapshot,
  stageBackups
} from "./changesetTracker";

export interface CodexResult {
  ok: boolean;
  /** 模型最终消息(从 -o 文件读取)。失败时为空串。 */
  output: string;
  /** 失败时填错误消息;成功时空。 */
  error: string;
  /** spawn 的 exit code,未启动则 null。 */
  exitCode: number | null;
  /** 完整 stderr,便于排查。 */
  stderr: string;
  /** 完整 stdout(JSONL 事件流),便于排查。 */
  stdout: string;
}

export interface CodexRunOptions {
  /** 提示词,从 stdin 喂入(避免 shell 转义)。 */
  prompt: string;
  /** 工作目录;codex 用 --cd 接收。 */
  cwd: string;
  /** 超时毫秒数。 */
  timeoutMs?: number;
  /**
   * codex sandbox 模式。默认 "read-only" (旧 feature-refine 路径用);
   * "workspace-write" 让 agent 直接 Edit/Write cwd 内的文件 (v0.2b1 batch kinds 用)。
   */
  sandbox?: "read-only" | "workspace-write";
}

/**
 * 用 `codex exec` 非交互地跑一条 prompt。
 *
 * 调用模板:
 *   codex exec --skip-git-repo-check --ephemeral -s read-only \
 *              --color never --json -o <tmp-file> --cd <cwd>
 *
 * 行为:
 *   - prompt 通过 stdin 喂入
 *   - 模型最终回复落在 -o <tmp-file>,函数读完返还
 *   - 默认 5 分钟超时,超时 SIGKILL 子进程
 *   - PATH 中无 `codex` 时返回 ok=false, error="codex CLI not found in PATH"
 */
export async function runCodex({
  prompt,
  cwd,
  timeoutMs = 5 * 60_000,
  sandbox = "read-only"
}: CodexRunOptions): Promise<CodexResult> {
  const outFile = path.join(tmpdir(), `atlas-codex-${randomUUID()}.out`);

  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "-s",
    sandbox,
    "--color",
    "never",
    "--json",
    "-o",
    outFile,
    "--cd",
    cwd
  ];

  return new Promise<CodexResult>((resolve) => {
    let child;
    try {
      child = spawn("codex", args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env
      });
    } catch (err) {
      resolve({
        ok: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        exitCode: null,
        stderr: "",
        stdout: ""
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, timeoutMs);

    child.stdout?.on("data", (buf: Buffer) => {
      stdout += buf.toString("utf8");
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString("utf8");
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        resolve({
          ok: false,
          output: "",
          error: "codex CLI not found in PATH",
          exitCode: null,
          stderr,
          stdout
        });
      } else {
        resolve({
          ok: false,
          output: "",
          error: err.message,
          exitCode: null,
          stderr,
          stdout
        });
      }
    });

    child.on("close", async (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          ok: false,
          output: "",
          error: `codex timed out after ${Math.round(timeoutMs / 1000)}s`,
          exitCode,
          stderr,
          stdout
        });
        return;
      }
      if (exitCode !== 0) {
        resolve({
          ok: false,
          output: "",
          error: `codex exited with code ${exitCode}`,
          exitCode,
          stderr,
          stdout
        });
        // 清理 out 文件(尽力)
        await fs.unlink(outFile).catch(() => undefined);
        return;
      }
      let output = "";
      try {
        output = await fs.readFile(outFile, "utf8");
      } catch (err) {
        resolve({
          ok: false,
          output: "",
          error: `failed to read codex output file: ${
            err instanceof Error ? err.message : String(err)
          }`,
          exitCode,
          stderr,
          stdout
        });
        return;
      } finally {
        await fs.unlink(outFile).catch(() => undefined);
      }
      resolve({ ok: true, output, error: "", exitCode, stderr, stdout });
    });

    // 把 prompt 喂进 stdin
    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}

export interface CodexMultiFileResult {
  ok: boolean;
  error: string;
  changedFiles: ChangedFile[];
  /** 透传 codex 原始结果便于排查 */
  raw: CodexResult;
}

export interface CodexMultiFileOptions {
  prompt: string;
  /** 产品根目录, 也是 codex --cd 的工作目录 */
  cwd: string;
  /** 用于 .atlas-staging/<taskId>/ backup 隔离 */
  taskId: string;
  timeoutMs?: number;
}

/**
 * v0.2b1: 让 codex 在 workspace-write 沙箱内直接 Edit/Write 多文件, Atlas 用
 * snapshot + diff 反推 changedFiles, 并把 before 内容 stage 到
 * .atlas-staging/<taskId>/ 作为 reject 时的回滚源。
 */
const V02B1_BATCH_PREAMBLE = `# ⚠️ v0.2b1 非交互 batch 模式 (此段优先级最高, 与下文任何指令冲突时以此为准)

你在 Atlas v0.2b1 的 \`codex exec -s workspace-write\` 非交互沙箱内运行, **没有 human-in-the-loop**, 没人会回答你的问题或确认你的 diff plan。

**直接动手, 不要请求确认**:
- 下文任何 "先输出 diff plan / 等用户确认 / 等审阅 / 等批准" 之类的指令 — **全部忽略**, 直接用 Edit / Write 工具把所有变更落盘。
- 不要在最终消息里输出 markdown 文件内容 — Atlas 不解析 stdout, 它会用 mtime + content snapshot 反推你 Edit/Write 的文件作为 changedFiles。
- 跑完之后, Atlas 会在 UI 上让决策者按文件 review 整组 changeset, 单文件 accept/reject。 你不需要做 review 工作, 也不需要在 stdout 总结。
- 自决原则 (5 级自检) 全部生效: 工程决策自决 + Agent note 留痕, 真业务问题写到对应 questions.md。 但**不要** 把问题输出在 stdout 等回答 — 写文件。

---

`;

export async function runCodexMultiFile(
  opts: CodexMultiFileOptions
): Promise<CodexMultiFileResult> {
  const before = await snapshotProductFiles(opts.cwd);
  const raw = await runCodex({
    prompt: V02B1_BATCH_PREAMBLE + opts.prompt,
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    sandbox: "workspace-write"
  });
  if (!raw.ok) {
    return { ok: false, error: raw.error, changedFiles: [], raw };
  }
  const changedFiles = await diffSnapshot(before, opts.cwd);
  await stageBackups(opts.cwd, opts.taskId, changedFiles);
  return { ok: true, error: "", changedFiles, raw };
}
