import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ChangedFile } from "@atlas/shared";
import {
  snapshotProductFiles,
  diffSnapshot,
  stageBackups,
  type Snapshot
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
  /**
   * v0.2c §5.6a: 边 stdout 边解析 JSONL 事件流, 每条业务级 step 调一次。
   * 解析逻辑 in extractStepFromCodexEvent.
   */
  onStep?: (label: string) => void;
  /** 注册到进程表的 key, 用于外部 cancelCodexRun(taskId) 杀进程。 */
  taskId?: string;
}

/** 运行中的 codex 子进程表 (taskId → child), 供 cancelCodexRun 终止。 */
const runningChildren = new Map<string, ReturnType<typeof spawn>>();

/** 终止运行中的 codex 进程 (delete 运行中任务用)。返回是否找到并杀了进程。 */
export function cancelCodexRun(taskId: string): boolean {
  const child = runningChildren.get(taskId);
  if (!child) return false;
  try {
    child.kill("SIGKILL");
  } catch {
    /* ignore */
  }
  runningChildren.delete(taskId);
  return true;
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
/** v0.2c §5.6a: 从 codex JSONL 事件抽业务级 step 文字, 返 null 表示不渲染. */
export function extractStepFromCodexEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;
  if (e.type !== "item.started") return null;
  const item = e.item as Record<string, unknown> | undefined;
  if (!item) return null;
  if (item.type !== "command_execution") return null;
  const cmd = String(item.command ?? "").trim();
  if (!cmd) return null;
  // 抽 curl /api/agent/<op>/<scope>
  const m = cmd.match(/curl\s+[^\s]*\s*(?:-[A-Za-z]+\s+\S+\s+)*[-X]*\s*(?:POST|GET)?\s*['"]?(?:https?:\/\/[^/]+)?\/api\/agent\/(\w+)(?:\/(\w+))?/i);
  if (m) {
    const op = m[1];
    const scope = m[2] ?? "";
    if (op === "validate") return `校验 ${scope}`;
    if (op === "propose") return `提议写入 ${scope}`;
    if (op === "feedback") return "查询反馈池";
    if (["feature", "entity", "usecase", "screen", "actor"].includes(op)) return `读取 ${op}`;
  }
  // 文件操作 (apply_patch / sed / cat 等)
  if (cmd.includes("apply_patch")) return "落盘文件";
  if (cmd.match(/^(cat|head|tail)\s/)) return "读文件";
  if (cmd.match(/^(rm|mv|cp)\s/)) return "文件操作";
  if (cmd.match(/^(ls|find|grep|rg)\s/)) return "扫描文件";
  // 默认截 cmd 前 50 字
  const short = cmd.length > 50 ? cmd.slice(0, 50) + "..." : cmd;
  return `执行 ${short}`;
}

export async function runCodex({
  prompt,
  cwd,
  timeoutMs = 5 * 60_000,
  sandbox = "read-only",
  onStep,
  taskId
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
  // v0.2c §5.4: workspace-write 模式放行 localhost 网络, 让 agent 能 curl
  // http://127.0.0.1:3001/api/agent/* 调 Atlas validate/inspect/propose
  if (sandbox === "workspace-write") {
    args.splice(args.indexOf("--cd"), 0, "-c", "sandbox_workspace_write.network_access=true");
  }

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

    // 注册到进程表, 供 cancelCodexRun 终止; settle 时清理。
    if (taskId) runningChildren.set(taskId, child);
    const deregister = () => {
      if (taskId) runningChildren.delete(taskId);
    };

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

    let stdoutBuffer = ""; // 用于 line-split JSONL
    child.stdout?.on("data", (buf: Buffer) => {
      const chunk = buf.toString("utf8");
      stdout += chunk;
      if (!onStep) return;
      stdoutBuffer += chunk;
      let idx: number;
      while ((idx = stdoutBuffer.indexOf("\n")) >= 0) {
        const line = stdoutBuffer.slice(0, idx).trim();
        stdoutBuffer = stdoutBuffer.slice(idx + 1);
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          const step = extractStepFromCodexEvent(evt);
          if (step) onStep(step);
        } catch {
          // 非 JSON 行 (如 stderr 混进来的或 "Reading prompt from stdin..."), 忽略
        }
      }
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString("utf8");
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      deregister();
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
      deregister();
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
  /** v0.2c §5.6a: 透传给 runCodex 的实时 step 回调 */
  onStep?: (label: string) => void;
  /**
   * 改造 2:外部传入的基线 snapshot。提供时用它当 before(多轮 execute→fix 累积 diff 从同一
   * 基线算,changeset 反映从原始态到当前的全量变更);不提供则函数内部即时 snapshot(单轮旧行为)。
   */
  baselineSnapshot?: Snapshot;
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

**Atlas HTTP API 强制校验 (v0.2c §5.4) — 优先使用**:
你每写完一个 .md 文件, **必须**用 Bash 调 Atlas validate endpoint:

\`\`\`bash
curl -s -X POST http://127.0.0.1:3001/api/agent/validate/<scope> \\
  -H "Content-Type: application/json" \\
  -d "{\"content\": $(jq -Rs . < path/to/file.md), \"targetId\": \"<id-from-filename>\"}"
\`\`\`

- scope ∈ feature / entity / usecase / screen / actor
- HTTP 200 = 通过; HTTP 422 = 返 errors[], 你按 errors 自修后再调一次
- 不通过就不算完成, 必须 Edit 修复后重校验直到 200
- 推荐用 POST /api/agent/propose/<scope> 替代直接 Edit/Write (它一次性带校验)

**Atlas HTTP API 查询 endpoints** (按需用, 替代靠 prompt 拼大段上下文):
- GET /api/agent/feature/<productId>/<featureId> — 拿 feature 结构化对象
- GET /api/agent/entity/<productId>/<entityName>
- GET /api/agent/usecase/<productId>/<usecaseId>
- GET /api/agent/screen/<productId>/<screenId>
- GET /api/agent/feedback?productId=<id>&scope=<scope> — 反馈池查询

productId 从 \`pwd\` 取 (cwd 是 data/products/<id>/)。

**Self-critique fallback (HTTP 不可达时)**:
如果 curl 网络失败, 退到本地自查:
1. 用 Read 重读自己刚写的文件全文
2. 按对应 contract 自查 schema (\`docs/<scope>-contract.md\`):
   - feature.md → \`docs/feature-source-contract.md\` (字段表 6 列 / frontmatter 必填 id+name+module+created_at / kebab-case id)
   - entity.md → \`docs/entity-contract.md\` (字段表列数 / frontmatter / 决策段格式)
   - usecase.md → \`docs/usecase-contract.md\`
   - screen.md → \`docs/screen-contract.md\` (entity_visibility yaml schema / usecase_ids 数组)
   - actor.md → \`docs/actor-contract.md\`
3. 列出违规, Edit 修订, 重新自查直到通过

**最常踩的坑** (你历史上反复犯):
- 6 列字段表被写成 4 列 → 解析器把字段位移到错列
- frontmatter 漏 \`id\` / \`name\` / \`module\` / \`created_at\` → parser 报 schema fail
- revise 模式忘记把 \`needs_revision: true\` 删除, 或 \`## 反馈池\` 没清空为 \`[]\`, 或 \`## 修订记录\` 没追加
- generate 模式给新文件错误地写了 \`needs_revision: true\` (新建即基线, 不应有这个标)
- entity id 用 kebab-case (应 PascalCase) / 字段名用 PascalCase (应 snake_case)

**违规没自修就交付 = 任务事实上失败**, PM 在 UI 上 reject 后会重跑 — 浪费一次完整 batch 时长。 自修是必须的, 不是可选。

---

`;

export async function runCodexMultiFile(
  opts: CodexMultiFileOptions
): Promise<CodexMultiFileResult> {
  const before = opts.baselineSnapshot ?? (await snapshotProductFiles(opts.cwd));
  const raw = await runCodex({
    prompt: V02B1_BATCH_PREAMBLE + opts.prompt,
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    sandbox: "workspace-write",
    onStep: opts.onStep,
    taskId: opts.taskId
  });
  if (!raw.ok) {
    return { ok: false, error: raw.error, changedFiles: [], raw };
  }
  const changedFiles = await diffSnapshot(before, opts.cwd);
  await stageBackups(opts.cwd, opts.taskId, changedFiles);
  return { ok: true, error: "", changedFiles, raw };
}
