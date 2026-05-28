import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import type { RefineTask, TaskStage } from "@atlas/shared";
import { featureFilePath, loadFeature } from "./entityLoader";
import { parseFeatureMarkdown } from "./featureParser";
import { runCodex } from "./codexRunner";
import { bumpDataVersion } from "./watcher";
import { AGENT_SELF_DECISION_PRINCIPLE, DECISION_MAKER_VIEW_GUIDE } from "./revisePromptBuilder";

/**
 * 单 agent 串行任务队列。每次最多跑 1 个,任务跑完后状态变 awaiting_review,
 * 文件级 .draft 等待用户接受/拒绝/重做。
 *
 * 任务在进程内存中持有;Atlas 重启则丢失(也丢失 .draft 文件无人接管的状态)。
 * 项目 A 范围内可接受。
 */

interface InternalTask extends RefineTask {
  /** 给 worker 用的 prompt + ctx;不上 API */
  payload: {
    productId: string;
    moduleName: string;
    featureId: string;
    productDir: string;
    extraInstruction?: string;
  };
}

const tasks: InternalTask[] = [];
let running = false;

/**
 * 把外部可见字段拷贝出来(剥离 payload)。
 */
function publicView(t: InternalTask): RefineTask {
  // 仅保留 RefineTask 字段;不暴露 payload
  return {
    id: t.id,
    productId: t.productId,
    kind: "feature-refine",
    title: t.featureName,
    moduleName: t.payload.moduleName,
    featureId: t.featureId,
    featureName: t.featureName,
    stage: t.stage,
    enqueuedAt: t.enqueuedAt,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt,
    error: t.error
  };
}

function setStage(t: InternalTask, stage: TaskStage, extra?: Partial<InternalTask>) {
  t.stage = stage;
  if (extra) Object.assign(t, extra);
  // 队列状态变化让前端 SSE 拉一次
  bumpDataVersion(`task:${t.id}:${stage}`);
}

export function getQueue(): RefineTask[] {
  return tasks.map(publicView);
}

export function getTask(id: string): RefineTask | null {
  const t = tasks.find((x) => x.id === id);
  return t ? publicView(t) : null;
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
  return publicView(t);
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

export async function approveTask(taskId: string): Promise<RefineTask | { error: string }> {
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return { error: "task not found" };
  if (t.stage !== "awaiting_review") return { error: `task is in stage ${t.stage}` };

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

export async function rejectTask(taskId: string): Promise<RefineTask | { error: string }> {
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return { error: "task not found" };
  if (t.stage !== "awaiting_review") return { error: `task is in stage ${t.stage}` };

  const filePath = featureFilePath(t.payload.productId, t.payload.moduleName, t.payload.featureId);
  await fs.unlink(`${filePath}.draft`).catch(() => undefined);
  setStage(t, "rejected", { finishedAt: new Date().toISOString() });
  return publicView(t);
}

export async function retryTask(
  taskId: string,
  extra?: string
): Promise<RefineTask | { error: string }> {
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return { error: "task not found" };
  if (t.stage !== "awaiting_review" && t.stage !== "failed" && t.stage !== "rejected") {
    return { error: `task is in stage ${t.stage}, cannot retry` };
  }

  const filePath = featureFilePath(t.payload.productId, t.payload.moduleName, t.payload.featureId);
  await fs.unlink(`${filePath}.draft`).catch(() => undefined);

  // 新建一个新任务,把 extra 拼上
  const next = enqueueRefine({
    productId: t.payload.productId,
    moduleName: t.payload.moduleName,
    featureId: t.payload.featureId,
    featureName: t.featureName,
    productDir: t.payload.productDir,
    extraInstruction: [t.payload.extraInstruction, extra].filter(Boolean).join("\n")
  });
  // 原任务标 rejected(已被新任务替代)
  if (t.stage === "awaiting_review") {
    setStage(t, "rejected", { finishedAt: new Date().toISOString() });
  }
  return next;
}
