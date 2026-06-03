import { randomUUID } from "node:crypto";
import type { AgentSession, AgentSessionTree, NodeState, InstructTask } from "@atlas/shared";
import { runCodex } from "./codexRunner";
import { buildSessionPlanPrompt, type PlannedTask } from "./generatePromptBuilder";
import { dataPath } from "./fileReader";
import { bumpDataVersion } from "./watcher";
import { enqueueBatch, getTask } from "./taskQueue";
import { resolveRepoDir } from "./repoResolver";

/**
 * 开发中阶段「需求框 → agent 改规格」的 Session 编排层(树的根)。
 *
 * 流程:createSession → 异步规划器(只读 codex 把一句话拆成 1..N 个带范围 Task)
 *      → 串行 enqueueBatch 各 Task(kind=product-instruct,带 sessionId)
 *      → 每个 Task 仍走现有三态闸独立审核(不另起 session 级审核态)。
 *
 * Session 不持审核状态;state 在读取时由子 Task 的 stage 派生。
 * 与 taskQueue 一样为进程内存持有,Atlas 重启则丢失(项目 A 范围可接受)。
 */

const sessions = new Map<string, AgentSession>();

/** 由子 Task 的 stage 派生 Session 树状态。 */
function deriveState(s: AgentSession): NodeState {
  // 还没拆出 Task → 规划进行中(或硬失败)
  if (s.taskIds.length === 0) return s.planError ? "failed" : "running";
  const stages = s.taskIds.map((id) => getTask(id)?.stage).filter(Boolean) as string[];
  if (stages.length === 0) return "running";
  const terminal = (st: string) => st === "completed" || st === "rejected" || st === "failed";
  if (stages.every(terminal)) return "finished";
  return "running";
}

function viewSession(s: AgentSession): AgentSession {
  return { ...s, state: deriveState(s) };
}

export function getSessionTree(id: string): AgentSessionTree | null {
  const s = sessions.get(id);
  if (!s) return null;
  const tasks = s.taskIds
    .map((tid) => getTask(tid))
    .filter((t): t is InstructTask => !!t && (t.kind === "product-instruct" || t.kind === "code-instruct"));
  return { session: viewSession(s), tasks };
}

export function listSessionsForProduct(productId: string): AgentSessionTree[] {
  return [...sessions.values()]
    .filter((s) => s.productId === productId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) // 新的在前
    .map((s) => getSessionTree(s.id))
    .filter((t): t is AgentSessionTree => !!t);
}

/** 从规划器输出里抽第一个 ```json 块并解析出 tasks[]。 */
function parsePlannedTasks(output: string): PlannedTask[] | null {
  const fence = output.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  const raw = fence ? fence[1] : output;
  try {
    const obj = JSON.parse(raw.trim());
    const arr = Array.isArray(obj) ? obj : obj?.tasks;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const out: PlannedTask[] = [];
    for (const item of arr) {
      const scoped = typeof item?.scopedInstruction === "string" ? item.scopedInstruction.trim() : "";
      if (!scoped) continue;
      out.push({
        title: typeof item?.title === "string" && item.title.trim() ? item.title.trim() : scoped.slice(0, 40),
        scopedInstruction: scoped,
        targetHint: typeof item?.targetHint === "string" ? item.targetHint.trim() : undefined
      });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** 兜底:整条需求作为单个 Task。 */
function fallbackTasks(instruction: string): PlannedTask[] {
  return [{ title: instruction.slice(0, 40), scopedInstruction: instruction }];
}

/** 异步规划 + 入队各 Task。失败则兜底单 Task。 */
async function planAndEnqueue(s: AgentSession): Promise<void> {
  if (s.target === "code") {
    await planAndEnqueueCode(s);
    return;
  }
  let planned: PlannedTask[];
  try {
    const { prompt } = await buildSessionPlanPrompt(s.productId, s.instruction);
    const result = await runCodex({
      prompt,
      cwd: dataPath("products", s.productId),
      timeoutMs: 5 * 60_000,
      sandbox: "read-only"
    });
    planned = (result.ok && parsePlannedTasks(result.output)) || fallbackTasks(s.instruction);
    if (!result.ok) s.planError = result.error || "planner failed, fell back to single task";
  } catch (err) {
    s.planError = err instanceof Error ? err.message : String(err);
    planned = fallbackTasks(s.instruction);
  }

  // scopedInstruction 带上 targetHint(若有),给执行 agent 多一句定位
  for (const p of planned) {
    const instruction = p.targetHint
      ? `${p.scopedInstruction}\n\n(预计涉及:${p.targetHint})`
      : p.scopedInstruction;
    const task = enqueueBatch({
      productId: s.productId,
      kind: "product-instruct",
      instruction,
      sessionId: s.id
    });
    s.taskIds.push(task.id);
  }
  bumpDataVersion(`session:${s.id}:planned`);
}

/**
 * 应用代码层规划(phase1):先解析/clone 真码仓,再入队**单个** code-instruct Task。
 * 多 Task 拆分 + worktree 并行留到 phase3(改造 3)。码仓解析失败 → 硬失败(无可跑的 Task)。
 */
async function planAndEnqueueCode(s: AgentSession): Promise<void> {
  let repoDir: string;
  try {
    repoDir = await resolveRepoDir(s.productId);
  } catch (err) {
    s.planError = err instanceof Error ? err.message : String(err);
    bumpDataVersion(`session:${s.id}:planned`);
    return; // taskIds 空 + planError → deriveState 返回 failed
  }
  const task = enqueueBatch({
    productId: s.productId,
    kind: "code-instruct",
    instruction: s.instruction,
    sessionId: s.id,
    repoDir
  });
  s.taskIds.push(task.id);
  bumpDataVersion(`session:${s.id}:planned`);
}

/**
 * 创建 Session:立即返回(taskIds 空 = 规划中),规划在后台异步进行。
 * 前端轮询 GET /api/sessions/:id 看树长出 Task。
 */
export function createSession(
  productId: string,
  instruction: string,
  target: "spec" | "code" = "spec"
): AgentSessionTree {
  const s: AgentSession = {
    id: randomUUID(),
    productId,
    instruction,
    state: "running",
    createdAt: new Date().toISOString(),
    taskIds: [],
    planError: null,
    target
  };
  sessions.set(s.id, s);
  bumpDataVersion(`session:${s.id}:created`);
  void planAndEnqueue(s); // 不阻塞 HTTP 响应
  return getSessionTree(s.id)!;
}
