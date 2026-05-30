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
  ConventionsGenerateTask,
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
  buildConventionsGeneratePrompt
} from "./generatePromptBuilder";
import { restoreFromBackups, clearBackups } from "./changesetTracker";
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
  | (ConventionsGenerateTask & { payload: BatchPayload });

const tasks: InternalTask[] = [];
let running = false;

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
}

export function getQueue(): Task[] {
  return tasks.map(publicView);
}

export function getTask(id: string): Task | null {
  const t = tasks.find((x) => x.id === id);
  return t ? publicView(t) : null;
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

async function tick(): Promise<void> {
  if (running) return;
  const next = tasks.find((t) => t.stage === "queued");
  if (!next) return;
  running = true;
  try {
    await runOne(next);
  } finally {
    running = false;
    // 看是否还有下一个
    void tick();
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
      case "conventions-generate":
        await runBatchRevise(t, buildConventionsGeneratePrompt);
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
    setStage(t, "failed", {
      finishedAt: new Date().toISOString(),
      error: "codex 跑完无任何文件变更, 可能 agent 判断无需改动或输出格式异常"
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
    } else {
      // batch kinds: 回滚 agent 写盘的变更 + 清 backup
      await restoreFromBackups(t.payload.productDir, t.id, t.changedFiles ?? []).catch(() => undefined);
      await clearBackups(t.payload.productDir, t.id).catch(() => undefined);
    }
  }

  tasks.splice(idx, 1);
  bumpDataVersion(`task:delete:${taskId}`);
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
    // batch kinds: 回滚 backup 再重排同 kind 任务 (extra 暂不支持, batch 没单独 prompt 调整渠道)
    if (t.stage === "awaiting_review") {
      const files = t.changedFiles ?? [];
      await restoreFromBackups(t.payload.productDir, t.id, files).catch(() => undefined);
    }
    next = enqueueBatch({ productId: t.payload.productId, kind: t.kind });
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
}

export function enqueueBatch(args: EnqueueBatchArgs): Task {
  const id = randomUUID();
  const productDir = dataPath("products", args.productId);
  const title = batchTaskTitle(args.kind);
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
    payload: { productId: args.productId, productDir }
  };
  // TS: 通过 kind 字面量给出具体 InternalTask 变体
  const t = base as InternalTask;
  tasks.push(t);
  bumpDataVersion(`task:enqueue:${id}`);
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
    case "conventions-generate": return "Generate conventions (batch)";
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
