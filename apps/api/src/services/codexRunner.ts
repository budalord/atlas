import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

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
  timeoutMs = 5 * 60_000
}: CodexRunOptions): Promise<CodexResult> {
  const outFile = path.join(tmpdir(), `atlas-codex-${randomUUID()}.out`);

  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "-s",
    "read-only",
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
