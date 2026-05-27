import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Feedback } from "@atlas/shared";
import { dataPath } from "./fileReader";
import { parseFeedbackSection, serializeFeedbackSection } from "./feedbackParser";

/**
 * 反馈池的写入面 — 严格 4 步原子流程:
 *   (1) fs.readFile 整文件
 *   (2) parseFeedbackSection(body) 拿到现有 Feedback[]
 *   (3) 在内存改 array(append / filter by id)
 *   (4) serializeFeedbackSection(new_array) 替换原 ## 反馈池 段 → fs.writeFile
 *
 * 任何中间步骤抛错,fs.writeFile 不执行,原 md 不变。
 *
 * 批次 1' 改动:
 *   - append 后自动给 frontmatter 写 needs_revision: true
 *   - delete 后若反馈池变空,自动从 frontmatter 抹掉 needs_revision
 */

export type FeedbackTarget =
  | { kind: "feature"; moduleId: string; featureId: string }
  | { kind: "entity"; entityId: string }
  | { kind: "entity-module"; moduleId: string; entityId: string }
  | { kind: "usecase"; moduleId: string; functionId: string; usecaseId: string }
  | { kind: "screen"; moduleId: string; screenId: string };

/**
 * "feature:<m>:<f>" / "entity:<e>" / "entity:<m>:<e>" / "usecase:<m>:<fn>:<u>" / "screen:<m>:<s>"
 * → 结构化 target。 不符合格式的 target 串返回 null, 由 route 转 400。
 */
export function parseTargetString(s: string): FeedbackTarget | null {
  const parts = s.split(":");
  const ID_RE = /^[a-z][a-z0-9-]*$/;
  if (parts[0] === "feature" && parts.length === 3) {
    if (!ID_RE.test(parts[1]) || !ID_RE.test(parts[2])) return null;
    return { kind: "feature", moduleId: parts[1], featureId: parts[2] };
  }
  if (parts[0] === "entity" && parts.length === 2) {
    if (!ID_RE.test(parts[1])) return null;
    return { kind: "entity", entityId: parts[1] };
  }
  if (parts[0] === "entity" && parts.length === 3) {
    if (!ID_RE.test(parts[1]) || !ID_RE.test(parts[2])) return null;
    return { kind: "entity-module", moduleId: parts[1], entityId: parts[2] };
  }
  if (parts[0] === "usecase" && parts.length === 4) {
    if (!ID_RE.test(parts[1]) || !ID_RE.test(parts[2]) || !ID_RE.test(parts[3])) return null;
    return { kind: "usecase", moduleId: parts[1], functionId: parts[2], usecaseId: parts[3] };
  }
  if (parts[0] === "screen" && parts.length === 3) {
    if (!ID_RE.test(parts[1]) || !ID_RE.test(parts[2])) return null;
    return { kind: "screen", moduleId: parts[1], screenId: parts[2] };
  }
  return null;
}

/** target → 文件绝对路径。该路径必须真实存在(否则视为 not found)。 */
export function resolveTargetFile(productId: string, target: FeedbackTarget): string {
  if (target.kind === "feature") {
    return dataPath(
      "products",
      productId,
      "modules",
      target.moduleId,
      "features",
      `${target.featureId}.md`
    );
  }
  if (target.kind === "entity") {
    return dataPath("products", productId, "entities", `${target.entityId}.md`);
  }
  if (target.kind === "entity-module") {
    return dataPath(
      "products",
      productId,
      "modules",
      target.moduleId,
      "entities",
      `${target.entityId}.md`
    );
  }
  if (target.kind === "usecase") {
    // 文件名仅 usecaseId(usecase-contract §4 规范, function_id 不在文件名重复)
    return dataPath(
      "products",
      productId,
      "modules",
      target.moduleId,
      "usecases",
      `${target.usecaseId}.md`
    );
  }
  // screen
  return dataPath(
    "products",
    productId,
    "modules",
    target.moduleId,
    "screens",
    `${target.screenId}.md`
  );
}

/**
 * 在 markdown 正文里替换 ## 反馈池 段;若段不存在,按 target.kind 选合适位置补段:
 *   - feature: 在 ## 线索池 段(含 ### Pending / ### Resolved)整段之后
 *   - entity: 在 ## 决策 段之后
 *   - 兜底: 文件末尾(保证前面空一行)
 */
export function replaceOrAppendFeedbackSection(
  body: string,
  newSectionText: string,
  kind: FeedbackTarget["kind"]
): string {
  const headingRe = /^##\s+反馈池\s*$/m;
  const m = body.match(headingRe);
  if (m && m.index !== undefined) {
    const startIdx = m.index;
    const rest = body.slice(startIdx + m[0].length);
    const nextRe = /\n(##?\s+)/;
    const next = rest.match(nextRe);
    const endIdx = next && next.index !== undefined
      ? startIdx + m[0].length + next.index + 1
      : body.length;
    const newSegment = newSectionText.endsWith("\n") ? newSectionText : `${newSectionText}\n`;
    return body.slice(0, startIdx) + newSegment + body.slice(endIdx);
  }

  const anchorRe =
    kind === "feature"
      ? /^##\s+线索池\s*$/m
      : kind === "entity" || kind === "entity-module"
      ? /^##\s+决策\s*$/m
      : kind === "usecase"
      ? /^##\s+备注\s*$/m
      : kind === "screen"
      ? /^##\s+设计决策\s*$/m
      : null;

  const newSegment = (body.endsWith("\n") ? "" : "\n") + "\n" + newSectionText;
  if (!anchorRe) return body + newSegment;

  const anchorMatch = body.match(anchorRe);
  if (!anchorMatch || anchorMatch.index === undefined) {
    return body + newSegment;
  }
  const anchorStart = anchorMatch.index;
  const restAfterAnchor = body.slice(anchorStart + anchorMatch[0].length);
  const nextHeading = restAfterAnchor.match(/\n(##?\s+)/);
  const insertAt =
    nextHeading && nextHeading.index !== undefined
      ? anchorStart + anchorMatch[0].length + nextHeading.index + 1
      : body.length;

  const insertSegment =
    insertAt < body.length
      ? `${newSectionText}\n`
      : `${body.endsWith("\n") ? "" : "\n"}\n${newSectionText}`;
  return body.slice(0, insertAt) + insertSegment + body.slice(insertAt);
}

/**
 * 在 frontmatter yaml 文本中保证存在 needs_revision: true。
 * 若该字段已存在(任何值)→ 改为 true;若不存在 → 在末尾追加一行。
 * 若 source 没有 frontmatter 块,则插入一个新的 frontmatter。
 */
export function setNeedsRevision(source: string): string {
  const fmMatch = source.match(/^(---\n)([\s\S]*?)(\n---\n?)/);
  if (!fmMatch) {
    return `---\nneeds_revision: true\n---\n${source}`;
  }
  const head = fmMatch[1];
  const inner = fmMatch[2];
  const tail = fmMatch[3];
  const rest = source.slice(fmMatch[0].length);

  const lineRe = /^needs_revision\s*:.*$/m;
  let newInner: string;
  if (lineRe.test(inner)) {
    newInner = inner.replace(lineRe, "needs_revision: true");
  } else {
    newInner = inner.replace(/\s*$/, "") + "\nneeds_revision: true";
  }
  return head + newInner + tail + rest;
}

/**
 * 在 frontmatter yaml 文本中删除 needs_revision 字段(若存在)。
 * 找不到 frontmatter / 找不到字段 → 原样返回。
 */
export function clearNeedsRevision(source: string): string {
  const fmMatch = source.match(/^(---\n)([\s\S]*?)(\n---\n?)/);
  if (!fmMatch) return source;
  const head = fmMatch[1];
  const inner = fmMatch[2];
  const tail = fmMatch[3];
  const rest = source.slice(fmMatch[0].length);

  const lineRe = /^needs_revision\s*:.*\n?/m;
  if (!lineRe.test(inner)) return source;
  const cleanedInner = inner.replace(lineRe, "").replace(/\n{2,}/g, "\n").replace(/^\n/, "").replace(/\n$/, "");
  return head + cleanedInner + tail + rest;
}

/** 生成 fb-<YYYYMMDD>-<6 位 base36 random>。 */
export function generateFeedbackId(today: string): string {
  const ymd = today.replace(/-/g, "");
  const rand = randomBytes(4).toString("hex").slice(0, 6);
  return `fb-${ymd}-${rand}`;
}

/**
 * 把一条 Feedback 追加到目标文件的反馈池里。同时给 frontmatter 写 needs_revision: true。
 *
 * 严格 4 步:
 *   (1) fs.readFile
 *   (2) parseFeedbackSection
 *   (3) id 冲突检测;冲突重生成
 *   (4) serializeFeedbackSection → replaceOrAppendFeedbackSection → setNeedsRevision → fs.writeFile
 */
export async function appendFeedback(
  productId: string,
  target: FeedbackTarget,
  feedback: Feedback
): Promise<Feedback> {
  const filePath = resolveTargetFile(productId, target);

  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FeedbackWriterError(`目标文件不存在: ${path.relative(dataPath(), filePath)}`, 404);
    }
    throw err;
  }

  const fmMatch = source.match(/^---\n[\s\S]*?\n---\n?/);
  const body = fmMatch ? source.slice(fmMatch[0].length) : source;

  const existing = parseFeedbackSection(body);

  const existingIds = new Set(existing.map((f) => f.id));
  let finalFeedback = feedback;
  while (existingIds.has(finalFeedback.id)) {
    finalFeedback = { ...finalFeedback, id: generateFeedbackId(finalFeedback.date) };
  }

  const nextArr = [...existing, finalFeedback];

  const newSection = serializeFeedbackSection(nextArr);
  const newBody = replaceOrAppendFeedbackSection(body, newSection, target.kind);
  const rebuilt = (fmMatch ? fmMatch[0] : "") + newBody;
  const newSource = setNeedsRevision(rebuilt);
  await fs.writeFile(filePath, newSource, "utf8");
  return finalFeedback;
}

/**
 * 按 id 删一条 Feedback。如果删完后反馈池为空,自动抹掉 frontmatter 的 needs_revision。
 *
 * 严格 4 步:
 *   (1) read
 *   (2) parse
 *   (3) filter by id
 *   (4) serialize → replace section → (条件) clearNeedsRevision → writeFile
 *
 * id 找不到 → 抛 404。
 */
export async function deleteFeedback(
  productId: string,
  target: FeedbackTarget,
  fbId: string
): Promise<void> {
  const filePath = resolveTargetFile(productId, target);

  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FeedbackWriterError(`目标文件不存在: ${path.relative(dataPath(), filePath)}`, 404);
    }
    throw err;
  }

  const fmMatch = source.match(/^---\n[\s\S]*?\n---\n?/);
  const body = fmMatch ? source.slice(fmMatch[0].length) : source;

  const existing = parseFeedbackSection(body);
  const idx = existing.findIndex((f) => f.id === fbId);
  if (idx < 0) {
    throw new FeedbackWriterError(`反馈 ${fbId} 不存在于该目标`, 404);
  }
  const nextArr = existing.filter((f) => f.id !== fbId);

  const newSection = serializeFeedbackSection(nextArr);
  const newBody = replaceOrAppendFeedbackSection(body, newSection, target.kind);
  let rebuilt = (fmMatch ? fmMatch[0] : "") + newBody;
  if (nextArr.length === 0) {
    rebuilt = clearNeedsRevision(rebuilt);
  }
  await fs.writeFile(filePath, rebuilt, "utf8");
}

export class FeedbackWriterError extends Error {
  constructor(message: string, public readonly httpStatus: number) {
    super(message);
    this.name = "FeedbackWriterError";
  }
}
