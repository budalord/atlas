import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import type {
  RefineTask,
  TaskStage,
  Task,
  TaskKind,
  FeatureRefineTask,
  FeatureReviseTask,
  UseCaseReviseTask,
  ScreenGenerateTask,
  ScreenReviseTask,
  ActorReviseTask,
  EntityReviseTask,
  EntityDeriveTask,
  FeatureGenerateTask,
  UseCaseGenerateTask,
  ConventionsGenerateTask,
  ProductInstructTask,
  CodeInstructTask,
  InstructTask,
  TaskPlan,
  ChangedFile
} from "@atlas/shared";
import { featureFilePath, loadFeature } from "./entityLoader";
import { parseFeatureMarkdown } from "./featureParser";
import { runCodex, runCodexMultiFile, cancelCodexRun } from "./codexRunner";
import { bumpDataVersion } from "./watcher";
import {
  AGENT_SELF_DECISION_PRINCIPLE,
  DECISION_MAKER_VIEW_GUIDE,
  buildFeatureRevisePrompt,
  buildUseCaseRevisePrompt,
  buildScreenRevisePrompt,
  buildActorRevisePrompt,
  buildEntityRevisePrompt
} from "./revisePromptBuilder";
import {
  buildScreenGeneratePrompt,
  buildEntityDerivePrompt,
  buildFeatureGeneratePrompt,
  buildUseCaseGeneratePrompt,
  buildConventionsGeneratePrompt,
  buildProductInstructPrompt,
  buildCodeInstructPrompt,
  buildValidatePrompt,
  buildFixPrompt
} from "./generatePromptBuilder";
import { restoreFromBackups, clearBackups, snapshotProductFiles, type Snapshot } from "./changesetTracker";
import { gitDiffChangedFiles, gitApprove } from "./gitChangeset";
import { createWorktree, removeWorktree, mergeWorktreeToMain } from "./worktreeManager";
import { flagRevisedScreensForReprototype } from "./prototypeQueue";
import { dataPath } from "./fileReader";
import { appendTaskHistory, buildHistoryRecord } from "./taskHistory";

/**
 * 单 agent 串行任务队列。每次最多跑 1 个,任务跑完后状态变 awaiting_review,
 * 等待用户接受/拒绝。
 *
 * v0.2b1: 5 种 kind 的任务共享同一队列, runOne / approve / reject 按 kind 分支:
 * - feature-refine: 旧路径, 单文件 .draft 模式
 * - feature-revise / usecase-revise / screen-revise: 新 batch, codex
 *   workspace-write 多文件, .atlas-staging/<taskId>/ 持 backup
 * - screen-generate: 同 batch 路径, 用 buildScreenGeneratePrompt
 *
 * 任务在进程内存中持有;Atlas 重启则丢失。 项目 A 范围内可接受。
 */

interface FeatureRefinePayload {
  productId: string;
  moduleName: string;
  featureId: string;
  productDir: string;
  extraInstruction?: string;
}

interface BatchPayload {
  productId: string;
  productDir: string;
  /** product-instruct / code-instruct 用:决策者自由文本子指令 */
  instruction?: string;
  /** product-instruct / code-instruct 用:所属 Session id(独立入队时为空串) */
  sessionId?: string;
  /** code-instruct 用:真码仓本地主 clone */
  repoDir?: string;
  /** 改造3:本 Task 的 worktree 隔离目录(cwd 指向这里) */
  worktreePath?: string;
  /** 改造3:worktree 分支名 */
  branch?: string;
}

type InternalTask =
  | (FeatureRefineTask & { payload: FeatureRefinePayload })
  | (FeatureReviseTask & { payload: BatchPayload })
  | (UseCaseReviseTask & { payload: BatchPayload })
  | (ScreenGenerateTask & { payload: BatchPayload })
  | (ScreenReviseTask & { payload: BatchPayload })
  | (ActorReviseTask & { payload: BatchPayload })
  | (EntityReviseTask & { payload: BatchPayload })
  | (EntityDeriveTask & { payload: BatchPayload })
  | (FeatureGenerateTask & { payload: BatchPayload })
  | (UseCaseGenerateTask & { payload: BatchPayload })
  | (ConventionsGenerateTask & { payload: BatchPayload })
  | (ProductInstructTask & { payload: BatchPayload })
  | (CodeInstructTask & { payload: BatchPayload });

const tasks: InternalTask[] = [];
/**
 * 改造 3:并发模型。
 * - 非代码任务(规格 batch / product-instruct):共享 productDir + .atlas-staging,**串行**(至多 1)。
 * - 代码任务(code-instruct):每 Task 独立 git worktree 隔离 → **有界并发**(至多 MAX_CODE_CONCURRENT)。
 * 两类可同时跑(各自工作目录不同,互不冲突)。
 */
let runningNonCode = false;
let activeCodeCount = 0;
const MAX_CODE_CONCURRENT = 2;

/**
 * 任务变更监听器(改造 5 持久化用)。sessionOrchestrator 注册一个,在 Task 状态/编排变化时
 * 把所属 Session 树落盘。用注册回调而非直接 import,保持 taskQueue → sessionOrchestrator 单向无环。
 */
type TaskChangeListener = (task: Task) => void;
const taskChangeListeners: TaskChangeListener[] = [];
export function onTaskChange(fn: TaskChangeListener): void {
  taskChangeListeners.push(fn);
}
function fireTaskChange(t: InternalTask): void {
  if (taskChangeListeners.length === 0) return;
  const view = publicView(t);
  for (const fn of taskChangeListeners) {
    try {
      fn(view);
    } catch {
      /* 监听器异常不影响队列 */
    }
  }
}

/** 公共字段集合 (各 kind 共用)。 */
function baseView(t: InternalTask) {
  return {
    id: t.id,
    productId: t.productId,
    kind: t.kind,
    title: t.title,
    stage: t.stage,
    enqueuedAt: t.enqueuedAt,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt,
    error: t.error,
    changedFiles: t.changedFiles,
    steps: t.steps,
    summaryLine: t.summaryLine
  };
}

/** 剥 payload 后的公开视图, 按 kind 决定字段集。 */
function publicView(t: InternalTask): Task {
  if (t.kind === "feature-refine") {
    return {
      ...baseView(t),
      kind: "feature-refine",
      moduleName: t.payload.moduleName,
      featureId: t.featureId,
      featureName: t.featureName
    } as FeatureRefineTask;
  }
  if (t.kind === "product-instruct") {
    const plans = (t as ProductInstructTask).plans ?? [];
    return {
      ...baseView(t),
      kind: "product-instruct",
      instruction: t.payload.instruction ?? "",
      sessionId: t.payload.sessionId ?? "",
      plans,
      // 让现有 AgentTasksPanel 仍能显示 running 步骤:把各 plan 的 steps 摊平回 task.steps
      steps: plans.flatMap((p) => p.steps)
    } as ProductInstructTask;
  }
  if (t.kind === "code-instruct") {
    const plans = (t as CodeInstructTask).plans ?? [];
    return {
      ...baseView(t),
      kind: "code-instruct",
      instruction: t.payload.instruction ?? "",
      sessionId: t.payload.sessionId ?? "",
      repoDir: t.payload.repoDir,
      worktreePath: t.payload.worktreePath,
      branch: t.payload.branch,
      plans,
      steps: plans.flatMap((p) => p.steps)
    } as CodeInstructTask;
  }
  return { ...baseView(t), kind: t.kind } as Task;
}

function setStage(t: InternalTask, stage: TaskStage, extra?: Partial<InternalTask>) {
  t.stage = stage;
  if (extra) Object.assign(t, extra);
  // 队列状态变化让前端 SSE 拉一次
  bumpDataVersion(`task:${t.id}:${stage}`);
  // v0.2c §5.6c: 终态时落盘 task-history (best-effort, 失败不影响 task 状态)
  // 已被 deleteTask 移出队列的任务 (如取消运行中) 不写 history, 避免脏记录。
  if ((stage === "completed" || stage === "rejected" || stage === "failed") && tasks.includes(t)) {
    const view = publicView(t);
    void appendTaskHistory(buildHistoryRecord(view, stage)).catch((e) => {
      console.warn(`task-history append failed for ${t.id}:`, e);
    });
  }
  // 改造 5:任何 stage 迁移都通知持久化(Session 树落盘)
  fireTaskChange(t);
}

export function getQueue(): Task[] {
  return tasks.map(publicView);
}

export function getTask(id: string): Task | null {
  const t = tasks.find((x) => x.id === id);
  return t ? publicView(t) : null;
}

/**
 * 改造 5:重启恢复 —— 从持久化的 Session 树把 InstructTask 回灌进队列。
 * - stage 归一:running(codex 子进程已随进程死)→ queued 重跑;其余原样(awaiting_review
 *   的工作树改动 / .atlas-staging 都在盘上,可续审)。
 * - 仅处理 instruct kinds(Session 树里只有这两种)。
 */
export function rehydrateInstructTask(view: InstructTask): void {
  if (tasks.some((x) => x.id === view.id)) return; // 去重
  const stage: TaskStage = view.stage === "running" ? "queued" : view.stage;
  const plans = (view.plans ?? []).map((p) => ({
    ...p,
    state: p.state === "running" ? "pending" : p.state,
    steps: p.steps ?? []
  })) as TaskPlan[];
  const isCode = view.kind === "code-instruct";
  const codeView = view as CodeInstructTask;
  const payload: BatchPayload = {
    productId: view.productId,
    productDir: dataPath("products", view.productId),
    instruction: view.instruction,
    sessionId: view.sessionId,
    ...(isCode
      ? { repoDir: codeView.repoDir, worktreePath: codeView.worktreePath, branch: codeView.branch }
      : {})
  };
  const t = {
    id: view.id,
    productId: view.productId,
    kind: view.kind,
    title: view.title,
    stage,
    enqueuedAt: view.enqueuedAt,
    startedAt: view.startedAt,
    finishedAt: view.finishedAt,
    error: view.error,
    changedFiles: view.changedFiles,
    summaryLine: view.summaryLine,
    plans,
    payload
  } as InternalTask;
  tasks.push(t);
}

/** 恢复完成后驱动 worker,把 queued(含被重置)任务跑起来。 */
export function resumeQueue(): void {
  void tick();
}

/** 单文件级 changeset 详情, 给 GET /:tid/changeset 用。 */
export function getTaskChangeset(id: string): ChangedFile[] | null {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  return t.changedFiles ?? [];
}

export interface EnqueueArgs {
  productId: string;
  moduleName: string;
  featureId: string;
  featureName: string;
  productDir: string;
  extraInstruction?: string;
}

export function enqueueRefine(args: EnqueueArgs): RefineTask {
  const id = randomUUID();
  const t: InternalTask = {
    id,
    productId: args.productId,
    kind: "feature-refine",
    title: args.featureName,
    moduleName: args.moduleName,
    featureId: args.featureId,
    featureName: args.featureName,
    stage: "queued",
    enqueuedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    payload: {
      productId: args.productId,
      moduleName: args.moduleName,
      featureId: args.featureId,
      productDir: args.productDir,
      extraInstruction: args.extraInstruction
    }
  };
  tasks.push(t);
  bumpDataVersion(`task:enqueue:${id}`);
  // 触发 worker(异步,不阻塞 enqueue 调用)
  void tick();
  return publicView(t) as FeatureRefineTask;
}

/**
 * 调度:扫描 queued 任务,在并发上限内拉起。非代码串行(runningNonCode),代码有界并发
 * (activeCodeCount<MAX_CODE_CONCURRENT)。worktree 隔离 → 同仓多 code 任务可并行,无需旧的串行守卫。
 * 同步函数:launch 是 fire-and-forget,flag 在循环里同步置位,防同一轮重复拉起。
 */
function tick(): void {
  for (const t of tasks) {
    if (t.stage !== "queued") continue;
    if (t.kind === "code-instruct") {
      if (activeCodeCount >= MAX_CODE_CONCURRENT) continue;
      activeCodeCount += 1;
      void launch(t);
    } else {
      if (runningNonCode) continue;
      runningNonCode = true;
      void launch(t);
    }
  }
}

/** 跑一个任务并在结束后释放并发额度 + 重新调度。 */
async function launch(t: InternalTask): Promise<void> {
  const isCode = t.kind === "code-instruct";
  try {
    await runOne(t);
  } finally {
    if (isCode) activeCodeCount -= 1;
    else runningNonCode = false;
    tick();
  }
}

async function runOne(t: InternalTask): Promise<void> {
  setStage(t, "running", { startedAt: new Date().toISOString() });
  try {
    switch (t.kind) {
      case "feature-refine":
        await runFeatureRefine(t);
        return;
      case "feature-revise":
        await runBatchRevise(t, buildFeatureRevisePrompt);
        return;
      case "usecase-revise":
        await runBatchRevise(t, buildUseCaseRevisePrompt);
        return;
      case "screen-revise":
        await runBatchRevise(t, buildScreenRevisePrompt);
        return;
      case "screen-generate":
        await runBatchRevise(t, buildScreenGeneratePrompt);
        return;
      case "actor-revise":
        await runBatchRevise(t, buildActorRevisePrompt);
        return;
      case "entity-revise":
        await runBatchRevise(t, buildEntityRevisePrompt);
        return;
      case "entity-derive":
        await runBatchRevise(t, buildEntityDerivePrompt);
        return;
      case "feature-generate":
        await runBatchRevise(t, buildFeatureGeneratePrompt);
        return;
      case "usecase-generate":
        await runBatchRevise(t, buildUseCaseGeneratePrompt);
        return;
      case "conventions-generate":
        await runBatchRevise(t, buildConventionsGeneratePrompt);
        return;
      case "product-instruct":
        await runProductInstruct(t);
        return;
      case "code-instruct":
        await runCodeInstruct(t);
        return;
    }
  } catch (err) {
    setStage(t, "failed", {
      finishedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

async function runFeatureRefine(
  t: FeatureRefineTask & { payload: FeatureRefinePayload }
): Promise<void> {
  const filePath = featureFilePath(t.payload.productId, t.payload.moduleName, t.payload.featureId);
  let originalSource: string;
  try {
    originalSource = await fs.readFile(filePath, "utf8");
  } catch (err) {
    setStage(t, "failed", {
      finishedAt: new Date().toISOString(),
      error: `read original failed: ${err instanceof Error ? err.message : String(err)}`
    });
    return;
  }

  const parsed = parseFeatureMarkdown(t.payload.featureId, originalSource);
  if (parsed.clues.pending.length === 0) {
    setStage(t, "failed", {
      finishedAt: new Date().toISOString(),
      error: "no pending clues to refine"
    });
    return;
  }

  const prompt = composePrompt(originalSource, parsed, t.payload.extraInstruction);
  const result = await runCodex({
    prompt,
    cwd: t.payload.productDir,
    timeoutMs: 5 * 60_000
  });

  if (!result.ok) {
    setStage(t, "failed", {
      finishedAt: new Date().toISOString(),
      error: result.error || "codex run failed"
    });
    return;
  }

  // 提取最终消息中的 markdown(模型可能包了 ```markdown 代码块)
  let draftMd = stripCodeFence(result.output.trim());
  if (!draftMd.startsWith("---")) {
    // 兜底:模型没按要求输出完整 frontmatter,任务标失败让用户重做
    setStage(t, "failed", {
      finishedAt: new Date().toISOString(),
      error:
        '模型输出不含 frontmatter("---" 起始),无法生成 draft。可点重做并附"请直接输出完整 md"补充指令。'
    });
    return;
  }

  // 在 frontmatter 中更新 last_refined_at(若未更新)
  draftMd = ensureLastRefinedAt(draftMd, new Date().toISOString().slice(0, 10));

  const draftPath = `${filePath}.draft`;
  try {
    await fs.writeFile(draftPath, draftMd, "utf8");
  } catch (err) {
    setStage(t, "failed", {
      finishedAt: new Date().toISOString(),
      error: `write draft failed: ${err instanceof Error ? err.message : String(err)}`
    });
    return;
  }

  setStage(t, "awaiting_review", { finishedAt: new Date().toISOString() });
}

/**
 * 复用通用 batch revise/generate 流程:
 * builder 出 prompt → codex workspace-write 多文件 → changesetTracker 反推
 * changedFiles → awaiting_review。 batch kinds 共享。
 */
type BatchTask =
  | (FeatureReviseTask & { payload: BatchPayload })
  | (UseCaseReviseTask & { payload: BatchPayload })
  | (ScreenGenerateTask & { payload: BatchPayload })
  | (ScreenReviseTask & { payload: BatchPayload })
  | (ActorReviseTask & { payload: BatchPayload })
  | (EntityReviseTask & { payload: BatchPayload })
  | (EntityDeriveTask & { payload: BatchPayload })
  | (FeatureGenerateTask & { payload: BatchPayload })
  | (UseCaseGenerateTask & { payload: BatchPayload })
  | (ConventionsGenerateTask & { payload: BatchPayload });

type PromptBuilder = (productId: string) => Promise<{ prompt: string }>;

async function runBatchRevise(t: BatchTask, builder: PromptBuilder): Promise<void> {
  let prompt: string;
  try {
    const built = await builder(t.payload.productId);
    prompt = built.prompt;
  } catch (err) {
    setStage(t, "failed", {
      finishedAt: new Date().toISOString(),
      error: `build prompt failed: ${err instanceof Error ? err.message : String(err)}`
    });
    return;
  }

  const result = await runCodexMultiFile({
    prompt,
    cwd: t.payload.productDir,
    taskId: t.id,
    timeoutMs: 30 * 60_000,
    // v0.2c §5.6a: 边收事件边写 step
    onStep: (label: string) => {
      const ts = new Date().toISOString();
      if (!t.steps) t.steps = [];
      t.steps.push({ ts, label });
      // 控制总条数, 防长 batch 占爆内存 — 仅留最近 30 条
      if (t.steps.length > 30) t.steps.splice(0, t.steps.length - 30);
      bumpDataVersion(`task:${t.id}:step`);
    }
  });

  if (!result.ok) {
    setStage(t, "failed", {
      finishedAt: new Date().toISOString(),
      error: result.error || "codex run failed"
    });
    return;
  }

  if (result.changedFiles.length === 0) {
    // 零变更不算失败: revise 任务无待处理项 / agent 判断无需改动是正常的。
    // 直接进 completed(无可审内容)+ "无变更" 摘要, 不报红 failed。
    setStage(t, "completed", {
      finishedAt: new Date().toISOString(),
      summaryLine: "本次无文件变更(无待处理项或 agent 判断无需改动)"
    });
    return;
  }

  // v0.2c §5.6b: 聚合 changedFiles.summary 算 task 级一句话
  const summaryLine = summarizeBatchTask(result.changedFiles);

  setStage(t, "awaiting_review", {
    finishedAt: new Date().toISOString(),
    changedFiles: result.changedFiles,
    summaryLine
  });
}

// ───────────── 改造 2:监管 agent(execute→validate→fix 多 Plan 环) ─────────────

/** fix 轮上限(execute 之后最多 fix 几次)。 */
const MAX_FIX_ROUNDS = 2;

/** 从只读复核 agent 输出里解析裁决。解析失败保守放行(不因格式问题卡正常改动)。 */
function parseVerdict(output: string): { pass: boolean; issues: string[] } {
  const fence = output.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  const raw = fence ? fence[1] : output;
  try {
    const obj = JSON.parse(raw.trim());
    const pass = obj?.pass === true;
    const issues = Array.isArray(obj?.issues)
      ? (obj.issues as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
    return { pass: pass || issues.length === 0, issues };
  } catch {
    return { pass: true, issues: [] };
  }
}

interface SuperviseCtx {
  productId: string;
  cwd: string;
  mode: "spec" | "code";
  instruction: string;
  /** 跑一次修复 agent,返回从原始基线算的累积 changeset。 */
  reExecuteFix: (
    fixPrompt: string,
    onStep: (label: string) => void
  ) => Promise<{ ok: boolean; changedFiles: ChangedFile[]; error: string }>;
}

/**
 * execute 之后、进闸之前的监管环:validate(只读复核)→ 不过则 fix(执行 agent 自修)→ 再 validate。
 * 把 validate/fix Plan 追加到 t.plans(现有 onStep/TaskStep 流式回显,前端已能渲染 plan.kind)。
 * 返回最终(累积)changeset。复用现有三态闸:无论复核是否最终通过,都进 awaiting_review 由人裁决。
 */
async function runSupervision(
  t: (ProductInstructTask | CodeInstructTask) & { payload: BatchPayload },
  initialChanged: ChangedFile[],
  ctx: SuperviseCtx
): Promise<ChangedFile[]> {
  if (!t.plans) t.plans = [];
  let changed = initialChanged;
  const pushStep = (plan: TaskPlan) => (label: string) => {
    plan.steps.push({ ts: new Date().toISOString(), label });
    if (plan.steps.length > 40) plan.steps.splice(0, plan.steps.length - 40);
    bumpDataVersion(`task:${t.id}:step`);
  };

  for (let round = 0; round <= MAX_FIX_ROUNDS; round++) {
    // —— validate Plan(只读复核) ——
    const vplan: TaskPlan = { id: randomUUID(), kind: "validate", state: "running", steps: [] };
    t.plans.push(vplan);
    bumpDataVersion(`task:${t.id}:step`);
    let verdict: { pass: boolean; issues: string[] };
    try {
      const { prompt } = await buildValidatePrompt(ctx.productId, ctx.instruction, changed.map((c) => c.path), ctx.mode);
      const vres = await runCodex({
        prompt,
        cwd: ctx.cwd,
        timeoutMs: 10 * 60_000,
        sandbox: "read-only",
        taskId: t.id,
        onStep: pushStep(vplan)
      });
      verdict = vres.ok ? parseVerdict(vres.output) : { pass: true, issues: [] };
    } catch {
      verdict = { pass: true, issues: [] }; // 复核器自身异常 → 放行(人审兜底)
    }
    vplan.changedFiles = changed;
    pushStep(vplan)(verdict.pass ? "复核通过 ✓" : `复核打回:${verdict.issues.length} 条问题`);
    vplan.state = verdict.pass ? "finished" : "failed";
    bumpDataVersion(`task:${t.id}:step`);

    if (verdict.pass) return changed;
    if (round === MAX_FIX_ROUNDS) return changed; // 超界:带问题进闸,人裁决

    // —— fix Plan(执行 agent 自修) ——
    const fplan: TaskPlan = { id: randomUUID(), kind: "fix", state: "running", steps: [] };
    t.plans.push(fplan);
    bumpDataVersion(`task:${t.id}:step`);
    const { prompt: fixPrompt } = buildFixPrompt(
      ctx.instruction,
      verdict.issues,
      ctx.mode,
      ctx.mode === "code" ? ctx.cwd : undefined
    );
    const fr = await ctx.reExecuteFix(fixPrompt, pushStep(fplan));
    if (!fr.ok) {
      fplan.state = "failed";
      return changed; // 修复失败,带原 changeset 进闸
    }
    fplan.changedFiles = fr.changedFiles;
    fplan.state = "finished";
    changed = fr.changedFiles;
  }
  return changed;
}

/**
 * 开发中阶段「需求 → 改规格」执行(Session 树里的单个 Task)。
 * 与 runBatchRevise 同构,差别:prompt 用 buildProductInstructPrompt(带自由文本指令),
 * 且把 codex 的实时 step 写进该 Task 的 execute Plan(plan.steps)而非 task 顶层。
 * 跑完先过监管环(改造 2),再落入现有三态闸(awaiting_review),审核走现有 ReviewChangesetModal。
 */
async function runProductInstruct(
  t: ProductInstructTask & { payload: BatchPayload }
): Promise<void> {
  if (!t.plans || t.plans.length === 0) {
    t.plans = [{ id: randomUUID(), kind: "execute", state: "pending", steps: [] }];
  }
  const plan = t.plans[0];
  plan.state = "running";

  let prompt: string;
  try {
    const built = await buildProductInstructPrompt(
      t.payload.productId,
      t.payload.instruction ?? ""
    );
    prompt = built.prompt;
  } catch (err) {
    plan.state = "failed";
    setStage(t, "failed", {
      finishedAt: new Date().toISOString(),
      error: `build prompt failed: ${err instanceof Error ? err.message : String(err)}`
    });
    return;
  }

  // 改造 2:基线 snapshot 取一次,execute + 各轮 fix 都从它算累积 changeset
  const cwd = t.payload.productDir;
  const baseline: Snapshot = await snapshotProductFiles(cwd);
  const onExecStep = (label: string) => {
    plan.steps.push({ ts: new Date().toISOString(), label });
    if (plan.steps.length > 40) plan.steps.splice(0, plan.steps.length - 40);
    bumpDataVersion(`task:${t.id}:step`);
  };
  const result = await runCodexMultiFile({
    prompt,
    cwd,
    taskId: t.id,
    timeoutMs: 30 * 60_000,
    baselineSnapshot: baseline,
    onStep: onExecStep
  });

  if (!result.ok) {
    plan.state = "failed";
    setStage(t, "failed", {
      finishedAt: new Date().toISOString(),
      error: result.error || "codex run failed"
    });
    return;
  }

  if (result.changedFiles.length === 0) {
    plan.state = "finished";
    setStage(t, "completed", {
      finishedAt: new Date().toISOString(),
      summaryLine: "本次无文件变更(agent 判断无需改动)"
    });
    return;
  }

  plan.changedFiles = result.changedFiles;
  plan.state = "finished";

  // 监管环:validate → fix → … (改造 2)
  const finalChanged = await runSupervision(t, result.changedFiles, {
    productId: t.payload.productId,
    cwd,
    mode: "spec",
    instruction: t.payload.instruction ?? "",
    reExecuteFix: async (fixPrompt, onStep) => {
      const fr = await runCodexMultiFile({
        prompt: fixPrompt,
        cwd,
        taskId: t.id,
        timeoutMs: 30 * 60_000,
        baselineSnapshot: baseline,
        onStep
      });
      return { ok: fr.ok, changedFiles: fr.changedFiles, error: fr.error };
    }
  });

  const summaryLine = summarizeBatchTask(finalChanged);
  setStage(t, "awaiting_review", {
    finishedAt: new Date().toISOString(),
    changedFiles: finalChanged,
    summaryLine
  });
}

/** 改造3:清理某 code Task 的 worktree(幂等,best-effort)。 */
async function cleanupTaskWorktree(t: CodeInstructTask & { payload: BatchPayload }): Promise<void> {
  const { repoDir, worktreePath, branch } = t.payload;
  if (!repoDir || !worktreePath || !branch) return;
  await removeWorktree(repoDir, t.id, worktreePath, branch).catch(() => undefined);
}

/**
 * 开发中(应用代码层)「需求 → 改真码仓代码」执行(Session 树里的单个 Task)。
 * 与 runProductInstruct 同构,差别:
 * - cwd = 真码仓本地 clone(payload.repoDir),不是 data/products/<id>
 * - 用 runCodex(workspace-write)直接跑(不走 runCodexMultiFile 的 .md snapshot)
 * - 变更追踪走 gitChangeset(git diff),reject 时 git reset,approve 时 git commit
 * 跑完仍落入现有三态闸(awaiting_review),审核走现有 ReviewChangesetModal。
 */
async function runCodeInstruct(
  t: CodeInstructTask & { payload: BatchPayload }
): Promise<void> {
  const repoDir = t.payload.repoDir;
  if (!repoDir) {
    setStage(t, "failed", { finishedAt: new Date().toISOString(), error: "code-instruct 缺少 repoDir(码仓未解析)" });
    return;
  }
  if (!t.plans || t.plans.length === 0) {
    t.plans = [{ id: randomUUID(), kind: "execute", state: "pending", steps: [] }];
  }
  const plan = t.plans[0];
  plan.state = "running";

  // 改造3:为本 Task 建独立 worktree(从主 clone 当前 HEAD 切分支),cwd 指向 worktree。
  // 同仓多 Task 各自工作树并行,互不写冲突。失败/终态时清理。
  let worktreePath: string;
  try {
    const wt = await createWorktree(repoDir, t.id);
    worktreePath = wt.worktreePath;
    t.payload.worktreePath = wt.worktreePath;
    t.payload.branch = wt.branch;
  } catch (err) {
    plan.state = "failed";
    setStage(t, "failed", {
      finishedAt: new Date().toISOString(),
      error: `创建 worktree 失败: ${err instanceof Error ? err.message : String(err)}`
    });
    return;
  }

  let prompt: string;
  try {
    const built = await buildCodeInstructPrompt(t.payload.productId, t.payload.instruction ?? "", worktreePath);
    prompt = built.prompt;
  } catch (err) {
    plan.state = "failed";
    setStage(t, "failed", {
      finishedAt: new Date().toISOString(),
      error: `build prompt failed: ${err instanceof Error ? err.message : String(err)}`
    });
    return;
  }

  const result = await runCodex({
    prompt,
    cwd: worktreePath,
    timeoutMs: 30 * 60_000,
    sandbox: "workspace-write",
    taskId: t.id,
    onStep: (label: string) => {
      const ts = new Date().toISOString();
      plan.steps.push({ ts, label });
      if (plan.steps.length > 40) plan.steps.splice(0, plan.steps.length - 40);
      bumpDataVersion(`task:${t.id}:step`);
    }
  });

  if (!result.ok) {
    plan.state = "failed";
    await cleanupTaskWorktree(t);
    setStage(t, "failed", {
      finishedAt: new Date().toISOString(),
      error: result.error || "codex run failed"
    });
    return;
  }

  let changedFiles: ChangedFile[];
  try {
    changedFiles = await gitDiffChangedFiles(worktreePath);
  } catch (err) {
    plan.state = "failed";
    await cleanupTaskWorktree(t);
    setStage(t, "failed", {
      finishedAt: new Date().toISOString(),
      error: `git diff failed: ${err instanceof Error ? err.message : String(err)}`
    });
    return;
  }

  if (changedFiles.length === 0) {
    plan.state = "finished";
    await cleanupTaskWorktree(t);
    setStage(t, "completed", {
      finishedAt: new Date().toISOString(),
      summaryLine: "本次无代码变更(agent 判断无需改动)"
    });
    return;
  }

  plan.changedFiles = changedFiles;
  plan.state = "finished";

  // 监管环:validate → fix → …(改造 2)。code 的 changeset 始终是 worktree 内 git diff HEAD,天然累积。
  const finalChanged = await runSupervision(t, changedFiles, {
    productId: t.payload.productId,
    cwd: worktreePath,
    mode: "code",
    instruction: t.payload.instruction ?? "",
    reExecuteFix: async (fixPrompt, onStep) => {
      const fr = await runCodex({
        prompt: fixPrompt,
        cwd: worktreePath,
        timeoutMs: 30 * 60_000,
        sandbox: "workspace-write",
        taskId: t.id,
        onStep
      });
      if (!fr.ok) return { ok: false, changedFiles, error: fr.error };
      try {
        const c = await gitDiffChangedFiles(worktreePath);
        return { ok: true, changedFiles: c, error: "" };
      } catch (err) {
        return { ok: false, changedFiles, error: err instanceof Error ? err.message : String(err) };
      }
    }
  });

  const summaryLine = `改动 ${finalChanged.length} 个文件(代码)`;
  setStage(t, "awaiting_review", {
    finishedAt: new Date().toISOString(),
    changedFiles: finalChanged,
    summaryLine
  });
}

/** 把 changedFiles[] 聚合成一句话, e.g. "新增 8 screen (academic 4 / channel 2) · 更新 9 usecase". */
function summarizeBatchTask(files: ChangedFile[]): string {
  if (files.length === 0) return "无变更";
  const byScope: Record<string, { create: number; update: number; delete: number; modules: Record<string, number> }> = {};
  for (const f of files) {
    const scope = f.path.match(/\/(features|entities|usecases|screens|actors)\//)?.[1]
      ?? (f.path.startsWith("entities/") ? "entities"
          : f.path.startsWith("derived/entities/") ? "entities (派生)"
          : "other");
    if (!byScope[scope]) byScope[scope] = { create: 0, update: 0, delete: 0, modules: {} };
    byScope[scope][f.action] += 1;
    const modMatch = f.path.match(/^modules\/([^/]+)\//);
    if (modMatch) {
      const m = modMatch[1];
      byScope[scope].modules[m] = (byScope[scope].modules[m] ?? 0) + 1;
    }
  }
  const parts: string[] = [];
  for (const [scope, c] of Object.entries(byScope)) {
    const subParts: string[] = [];
    if (c.create > 0) subParts.push(`新增 ${c.create}`);
    if (c.update > 0) subParts.push(`更新 ${c.update}`);
    if (c.delete > 0) subParts.push(`删 ${c.delete}`);
    const modList = Object.entries(c.modules).map(([m, n]) => `${m} ${n}`).join(" / ");
    const modSfx = modList ? ` (${modList})` : "";
    parts.push(`${subParts.join("·")} ${scope}${modSfx}`);
  }
  return parts.join(" · ");
}

function composePrompt(
  _originalSource: string,
  parsed: ReturnType<typeof parseFeatureMarkdown>,
  extra?: string
): string {
  const pending = parsed.clues.pending
    .map((c) => `- (${c.date}) ${c.content}`)
    .join("\n");
  const resolved = parsed.clues.resolved
    .map((c) => `- (${c.date}) ${c.content}`)
    .join("\n");

  return `你是 Atlas 的功能点描述优化 Agent (codex 非交互任务, 没有 human-in-loop, 全部自决)。

${AGENT_SELF_DECISION_PRINCIPLE}

${DECISION_MAKER_VIEW_GUIDE}

当前功能点:
- id: ${parsed.id}
- name: ${parsed.name}
- module: ${parsed.module}

当前描述:
${parsed.description}

待处理线索 (pending):
${pending || "(空)"}

已处理线索 (resolved, 仅供参考):
${resolved || "(空)"}

任务要求:
1. 改写"## 描述"段, 自然融入 pending 线索里的**合理**建议; 冲突的 / 明显不合理的 / **违反 AGENT_SELF_DECISION_PRINCIPLE 的**(操作参数无脑要决策者拍 / 工程决策包装成业务等) 不采纳但在 resolved 里标"未采纳: <理由>"
2. 把所有 pending 线索移动到 resolved 段, 日期保留原值
3. **如果线索涉及"给决策者" 内容**: 同步更新 \`## 给决策者\` 段, 严格按 DECISION_MAKER_VIEW_GUIDE 写, \`**待你拍**\` 段过 5 级自检 — 默认值能跑的选默认, 工程决策自决, 真业务规则才进 \`**待你拍**\` (硬上限 3 条)
4. 不要修改 frontmatter 的 id / name / module / created_at 字段; 可以更新 last_refined_at 为今天 (${new Date()
   .toISOString()
   .slice(0, 10)})
5. 不要修改其他段落 (## 线索池, ### Pending, ### Resolved 的标题保留)
6. **直接输出完整**的新 md 文件内容(包含 frontmatter), 不要套 \`\`\`markdown 代码块, 不要加任何解释性前后缀${
    extra
      ? `

补充指令(来自用户的重做要求):
${extra}`
      : ""
  }`;
}

/** 如果模型把回复包在 \`\`\`markdown ... \`\`\` 里,剥掉。 */
function stripCodeFence(text: string): string {
  const m = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return m ? m[1] : text;
}

function ensureLastRefinedAt(md: string, today: string): string {
  if (/last_refined_at\s*:/.test(md)) {
    return md.replace(
      /last_refined_at\s*:\s*[^\n]*/,
      `last_refined_at: ${today}`
    );
  }
  // 在 frontmatter 结尾的 --- 前插入
  return md.replace(/^(---\n[\s\S]*?)\n---\n/, `$1\nlast_refined_at: ${today}\n---\n`);
}

export interface DraftBundle {
  /** 原文件内容(主 md) */
  original: string;
  /** 草稿 .draft 文件内容 */
  draft: string;
}

/**
 * 读取功能点的 original + draft (若有)。
 */
export async function readDraft(
  productId: string,
  featureId: string
): Promise<DraftBundle | null> {
  const located = await loadFeature(productId, featureId);
  if (!located) return null;
  const filePath = featureFilePath(productId, located.moduleName, featureId);
  const original = await fs.readFile(filePath, "utf8");
  let draft = "";
  try {
    draft = await fs.readFile(`${filePath}.draft`, "utf8");
  } catch {
    return { original, draft: "" };
  }
  return { original, draft };
}

export async function approveTask(taskId: string): Promise<Task | { error: string }> {
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return { error: "task not found" };
  if (t.stage !== "awaiting_review") return { error: `task is in stage ${t.stage}` };

  if (t.kind === "feature-refine") {
    const filePath = featureFilePath(t.payload.productId, t.payload.moduleName, t.payload.featureId);
    const draftPath = `${filePath}.draft`;
    try {
      const original = await fs.readFile(filePath, "utf8");
      const draft = await fs.readFile(draftPath, "utf8");
      // 给"新增到 Resolved 段"的线索行标注 [task:taskId],方便 UI 反查这条线索是哪个 Codex 任务处理的。
      const tagged = annotateNewlyResolvedWithTaskId(original, draft, t.id);
      await fs.writeFile(filePath, tagged, "utf8");
      await fs.unlink(draftPath).catch(() => undefined);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  } else if (t.kind === "code-instruct") {
    // 代码任务:approve = 在 worktree 分支提交 → 合并回主 clone 主线 → 清理 worktree
    const { repoDir, worktreePath, branch } = t.payload;
    if (repoDir && worktreePath && branch) {
      try {
        await gitApprove(worktreePath, `Atlas: ${t.title}`);
        await mergeWorktreeToMain(repoDir, branch);
      } catch (err) {
        return { error: `合并落地失败: ${err instanceof Error ? err.message : String(err)}` };
      }
      await cleanupTaskWorktree(t);
    }
  } else {
    // batch kinds: 文件已被 agent workspace-write 落盘, approve = 清 backup
    await clearBackups(t.payload.productDir, t.id).catch(() => undefined);
    // 联动: 规格被改且已有原型图的屏, 自动入队重出(旧图按旧规格画的, 已过时)
    const reflagged = await flagRevisedScreensForReprototype(
      t.payload.productId,
      t.changedFiles ?? []
    ).catch(() => [] as string[]);
    if (reflagged.length > 0) bumpDataVersion(`task:${t.id}:reprototype`);
  }

  setStage(t, "completed", { finishedAt: new Date().toISOString() });
  void tick(); // 被并发守卫挡住的同仓 code 任务可续跑
  return publicView(t);
}

/**
 * 后处理:在 draft 的 "### Resolved" 段里,把"原 Resolved 段没有"的新增条目
 * 加上 [task:taskId] 前缀。原条目和已带标记的条目都不动。
 *
 * 实现:
 *   - 抽取 original 的 Resolved 段,建 set { "date|content" }
 *   - 在 draft 文本上,定位 ### Resolved 段;对每行匹配 `- (date) content`:
 *     - 若 content 已有 [task:...] / [issue:...] 前缀 → 不动
 *     - 若 (date|去前缀content) 在 originalSet → 不动(已存在的旧条目)
 *     - 否则 → 改写为 `- (date) [task:taskId] content`
 */
export function annotateNewlyResolvedWithTaskId(
  original: string,
  draft: string,
  taskId: string
): string {
  const origResolved = extractResolvedKeys(original);
  const lines = draft.split("\n");
  let inResolved = false;
  let resolvedHeadingLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#+)\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      if (text === "Resolved") {
        inResolved = true;
        resolvedHeadingLevel = level;
        continue;
      }
      // 同级或更浅的标题:退出 Resolved 段
      if (inResolved && level <= resolvedHeadingLevel) {
        inResolved = false;
      }
      continue;
    }
    if (!inResolved) continue;
    const m = line.match(/^(\s*-\s*)\((\d{4}-\d{2}-\d{2})\)\s*(.+)$/);
    if (!m) continue;
    const [, prefix, date, rest] = m;
    // 已带 [task:...] 或 [issue:...] 前缀:不动
    if (/^\[(task|issue):/.test(rest.trim())) continue;
    const key = `${date}|${rest.trim()}`;
    if (origResolved.has(key)) continue;
    lines[i] = `${prefix}(${date}) [task:${taskId}] ${rest.trim()}`;
  }
  return lines.join("\n");
}

function extractResolvedKeys(md: string): Set<string> {
  const set = new Set<string>();
  const lines = md.split("\n");
  let inResolved = false;
  let resolvedHeadingLevel = 0;
  for (const line of lines) {
    const headingMatch = line.match(/^(#+)\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      if (text === "Resolved") {
        inResolved = true;
        resolvedHeadingLevel = level;
        continue;
      }
      if (inResolved && level <= resolvedHeadingLevel) inResolved = false;
      continue;
    }
    if (!inResolved) continue;
    const m = line.match(/^\s*-\s*\((\d{4}-\d{2}-\d{2})\)\s*(.+)$/);
    if (!m) continue;
    let rest = m[2].trim();
    // 剥前缀标记,与 parseClueLines 同步
    while (true) {
      const tm = rest.match(/^\[(task|issue):[^\]]+\]\s*/);
      if (!tm) break;
      rest = rest.slice(tm[0].length);
    }
    set.add(`${m[1]}|${rest.trim()}`);
  }
  return set;
}

export async function rejectTask(taskId: string): Promise<Task | { error: string }> {
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return { error: "task not found" };
  if (t.stage !== "awaiting_review") return { error: `task is in stage ${t.stage}` };

  if (t.kind === "feature-refine") {
    const filePath = featureFilePath(t.payload.productId, t.payload.moduleName, t.payload.featureId);
    await fs.unlink(`${filePath}.draft`).catch(() => undefined);
  } else if (t.kind === "code-instruct") {
    // 代码任务:reject = 丢弃 worktree(连同未提交改动 + 分支),不碰主线
    await cleanupTaskWorktree(t);
  } else {
    // batch kinds: 把 .atlas-staging/<taskId>/ backup 回滚到原位置
    const files = t.changedFiles ?? [];
    try {
      await restoreFromBackups(t.payload.productDir, t.id, files);
    } catch (err) {
      return { error: `restore failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  setStage(t, "rejected", { finishedAt: new Date().toISOString() });
  void tick(); // 被并发守卫挡住的同仓 code 任务可续跑
  return publicView(t);
}

/**
 * 删除/取消任务, 从队列里整个移除 (UI 上消失)。 按 stage 处理:
 *   - queued: 还没跑, 直接移除 (不会被 tick 选中)。
 *   - running: 杀掉 codex 子进程再移除; 可能留下半截写盘的文件 (agent 重跑可修)。
 *   - awaiting_review: 先把 agent 写盘的变更回滚到 backup (等同 reject), 再移除。
 *   - completed/rejected/failed: 直接移除 (dismiss)。
 */
export async function deleteTask(taskId: string): Promise<{ ok: true } | { error: string }> {
  const idx = tasks.findIndex((x) => x.id === taskId);
  if (idx < 0) return { error: "task not found" };
  const t = tasks[idx];

  if (t.stage === "running") {
    cancelCodexRun(t.id);
  }

  if (t.stage === "awaiting_review") {
    if (t.kind === "feature-refine") {
      const filePath = featureFilePath(t.payload.productId, t.payload.moduleName, t.payload.featureId);
      await fs.unlink(`${filePath}.draft`).catch(() => undefined);
    } else if (t.kind === "code-instruct") {
      // 代码任务:丢弃 worktree
      await cleanupTaskWorktree(t);
    } else {
      // batch kinds: 回滚 agent 写盘的变更 + 清 backup
      await restoreFromBackups(t.payload.productDir, t.id, t.changedFiles ?? []).catch(() => undefined);
      await clearBackups(t.payload.productDir, t.id).catch(() => undefined);
    }
  }

  tasks.splice(idx, 1);
  bumpDataVersion(`task:delete:${taskId}`);
  fireTaskChange(t); // 改造 5:从树里移除后重落盘(该 Task 已不在 getSessionTree)
  void tick(); // 同仓被守卫挡住的 code 任务可续跑
  return { ok: true };
}

export async function retryTask(
  taskId: string,
  extra?: string
): Promise<Task | { error: string }> {
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return { error: "task not found" };
  if (t.stage !== "awaiting_review" && t.stage !== "failed" && t.stage !== "rejected") {
    return { error: `task is in stage ${t.stage}, cannot retry` };
  }

  let next: Task;
  if (t.kind === "feature-refine") {
    const filePath = featureFilePath(t.payload.productId, t.payload.moduleName, t.payload.featureId);
    await fs.unlink(`${filePath}.draft`).catch(() => undefined);
    next = enqueueRefine({
      productId: t.payload.productId,
      moduleName: t.payload.moduleName,
      featureId: t.payload.featureId,
      featureName: t.featureName,
      productDir: t.payload.productDir,
      extraInstruction: [t.payload.extraInstruction, extra].filter(Boolean).join("\n")
    });
  } else {
    // batch kinds: 回滚再重排同 kind 任务
    if (t.stage === "awaiting_review") {
      if (t.kind === "code-instruct") {
        await cleanupTaskWorktree(t);
      } else {
        const files = t.changedFiles ?? [];
        await restoreFromBackups(t.payload.productDir, t.id, files).catch(() => undefined);
      }
    }
    // product-instruct / code-instruct:带回原指令 + sessionId(+ code 的 repoDir),extra 追加
    const isInstruct = t.kind === "product-instruct" || t.kind === "code-instruct";
    const instruction = isInstruct ? [t.payload.instruction, extra].filter(Boolean).join("\n") : undefined;
    next = enqueueBatch({
      productId: t.payload.productId,
      kind: t.kind,
      instruction,
      sessionId: isInstruct ? t.payload.sessionId : undefined,
      repoDir: t.kind === "code-instruct" ? t.payload.repoDir : undefined
    });
  }

  if (t.stage === "awaiting_review") {
    setStage(t, "rejected", { finishedAt: new Date().toISOString() });
  }
  return next;
}

/** v0.2b1: 排一个 batch 任务 (feature-revise / usecase-revise / screen-generate / screen-revise)。 */
export interface EnqueueBatchArgs {
  productId: string;
  kind: Exclude<TaskKind, "feature-refine">;
  /** product-instruct / code-instruct 用:决策者自由文本子指令 */
  instruction?: string;
  /** product-instruct / code-instruct 用:所属 Session id */
  sessionId?: string;
  /** code-instruct 用:真码仓本地工作目录 */
  repoDir?: string;
}

/** product-instruct 的 Task 标题取指令前若干字。 */
function instructionTitle(instruction: string | undefined): string {
  const s = (instruction ?? "").trim().replace(/\s+/g, " ");
  if (!s) return "按需求改规格";
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

export function enqueueBatch(args: EnqueueBatchArgs): Task {
  const id = randomUUID();
  const productDir = dataPath("products", args.productId);
  const isInstruct = args.kind === "product-instruct" || args.kind === "code-instruct";
  const isCode = args.kind === "code-instruct";
  const title = isInstruct ? instructionTitle(args.instruction) : batchTaskTitle(args.kind);
  const base = {
    id,
    productId: args.productId,
    kind: args.kind,
    title,
    stage: "queued" as TaskStage,
    enqueuedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    payload: {
      productId: args.productId,
      productDir,
      ...(isInstruct ? { instruction: args.instruction ?? "", sessionId: args.sessionId ?? "" } : {}),
      ...(isCode ? { repoDir: args.repoDir } : {})
    },
    // product-instruct / code-instruct:初始化 execute Plan(Session 树的 Plan 层)
    ...(isInstruct
      ? { plans: [{ id: randomUUID(), kind: "execute", state: "pending", steps: [] }] as TaskPlan[] }
      : {})
  };
  // TS: 通过 kind 字面量给出具体 InternalTask 变体
  const t = base as InternalTask;
  tasks.push(t);
  bumpDataVersion(`task:enqueue:${id}`);
  fireTaskChange(t); // 改造 5:初始 queued 态落盘
  void tick();
  return publicView(t);
}

function batchTaskTitle(kind: Exclude<TaskKind, "feature-refine">): string {
  switch (kind) {
    case "feature-revise": return "Revise features (batch)";
    case "usecase-revise": return "Revise use cases (batch)";
    case "screen-revise": return "Revise screens (batch)";
    case "screen-generate": return "Generate screens (batch)";
    case "actor-revise": return "Revise actors (batch)";
    case "entity-revise": return "Revise entities (batch)";
    case "entity-derive": return "Derive entities (batch)";
    case "feature-generate": return "Generate features (batch)";
    case "usecase-generate": return "Generate use cases (batch)";
    case "conventions-generate": return "Generate conventions (batch)";
    case "product-instruct": return "按需求改规格";
    case "code-instruct": return "按需求改代码";
  }
}

/**
 * 单文件级 reject: 把 changedFiles[idx] 回滚 + 标记 reviewState=rejected。
 * task 整体仍 awaiting_review, 直到所有文件都被 accept/reject。
 */
export async function rejectChangesetFile(
  taskId: string,
  fileIdx: number
): Promise<Task | { error: string }> {
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return { error: "task not found" };
  if (t.kind === "feature-refine") return { error: "feature-refine kind has no per-file changeset" };
  if (t.stage !== "awaiting_review") return { error: `task is in stage ${t.stage}` };
  const files = t.changedFiles ?? [];
  if (fileIdx < 0 || fileIdx >= files.length) return { error: "file index out of range" };
  const f = files[fileIdx];
  if (f.reviewState === "rejected") return publicView(t);
  try {
    await restoreFromBackups(t.payload.productDir, t.id, [f]);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  f.reviewState = "rejected";
  bumpDataVersion(`task:${t.id}:file-reject:${fileIdx}`);
  return publicView(t);
}

/** 单文件级 accept: 仅标 reviewState=accepted (文件已经在 workspace, 不需操作)。 */
export function acceptChangesetFile(
  taskId: string,
  fileIdx: number
): Task | { error: string } {
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return { error: "task not found" };
  if (t.kind === "feature-refine") return { error: "feature-refine kind has no per-file changeset" };
  if (t.stage !== "awaiting_review") return { error: `task is in stage ${t.stage}` };
  const files = t.changedFiles ?? [];
  if (fileIdx < 0 || fileIdx >= files.length) return { error: "file index out of range" };
  const f = files[fileIdx];
  if (f.reviewState === "rejected") return { error: "already rejected, cannot accept" };
  f.reviewState = "accepted";
  bumpDataVersion(`task:${t.id}:file-accept:${fileIdx}`);
  return publicView(t);
}
