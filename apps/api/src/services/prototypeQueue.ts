import { promises as fs } from "node:fs";
import path from "node:path";
import { dataPath } from "./fileReader";
import { loadScreens, screenFilePath } from "./screenLoader";

/**
 * 原型图轨(双轨设计 · 界面轨视觉产物)出图队列 + 审核闸。
 *
 * 背景见 memory: codex-prototype-image-track。
 * codex CLI 不能文生图, 由 codex 客户端 drain 会话主动 curl Atlas 拉队列 / 回传产物。
 *
 * 三态生命周期(frontmatter 驱动):
 *   - needs_prototype: true   → 出图队列(首出 / 重出请求), automation drain 消费
 *   - pending_prototype: path → 出好了等审核(暂存, 未生效)
 *   - preview_image: path     → 已通过 / 冻结的官方原型图
 *
 * 流转: 请求 → needs_prototype → (submit) pending_prototype → (通过) preview_image
 *                                                          ↘ (打回) 丢弃 + 重新 needs_prototype
 * 重出安全: 新图永远先进 pending_prototype, 审核通过前绝不覆盖已通过的 preview_image。
 *
 * 写入一律外科手术式 frontmatter 改写(setFmScalar / clearFmKey), 不 round-trip 整文件,
 * 保住 split_suggestion 等 parser 不解析的字段。 needs_prototype / preview_image /
 * pending_prototype 都是单行 scalar, 故安全。 一屏一闭环见下。
 */

export interface PendingPrototype {
  module: string;
  screenId: string;
  name: string;
  usecase_ids: string[];
  /** 已有已通过图时回带 — 表示这是重出/迭代而非首出 */
  preview_image?: string;
}

export interface PendingReviewItem {
  module: string;
  screenId: string;
  name: string;
  /** 待审的暂存图 */
  pending_prototype: string;
  /** 当前已通过的图(若有) — 重出场景下供对比, 通过后将被替换 */
  preview_image?: string;
}

/** 列出所有 needs_prototype=true 的 screen — 待出图队列(给 codex drain 会话)。 */
export async function listPendingPrototypes(productId: string): Promise<PendingPrototype[]> {
  const screens = await loadScreens(productId);
  return screens
    .filter((s) => s.needs_prototype)
    .map((s) => ({
      module: s.module,
      screenId: s.id,
      name: s.name,
      usecase_ids: s.usecase_ids,
      ...(s.preview_image ? { preview_image: s.preview_image } : {})
    }));
}

/** 列出所有有暂存待审图的 screen — 审核 inbox(给 PM)。 */
export async function listPendingReview(productId: string): Promise<PendingReviewItem[]> {
  const screens = await loadScreens(productId);
  return screens
    .filter((s) => s.pending_prototype)
    .map((s) => ({
      module: s.module,
      screenId: s.id,
      name: s.name,
      pending_prototype: s.pending_prototype as string,
      ...(s.preview_image ? { preview_image: s.preview_image } : {})
    }));
}

// ── 外科手术式 frontmatter 单行 scalar 读 / 写 / 删 ──────────────

/** 读 frontmatter 单行 scalar 值, 不存在返回 null。 */
function getFmScalar(source: string, key: string): string | null {
  const fmMatch = source.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const m = fmMatch[1].match(new RegExp(`^${key}\\s*:\\s*(.+)$`, "m"));
  return m ? m[1].trim() : null;
}

/** 设 frontmatter 单行 `key: value`(已存在改值, 否则末尾追加;无 fm 块则插入)。 */
function setFmScalar(source: string, key: string, value: string): string {
  const fmMatch = source.match(/^(---\n)([\s\S]*?)(\n---\n?)/);
  if (!fmMatch) return `---\n${key}: ${value}\n---\n${source}`;
  const [, head, inner, tail] = fmMatch;
  const rest = source.slice(fmMatch[0].length);
  const lineRe = new RegExp(`^${key}\\s*:.*$`, "m");
  const newInner = lineRe.test(inner)
    ? inner.replace(lineRe, `${key}: ${value}`)
    : inner.replace(/\s*$/, "") + `\n${key}: ${value}`;
  return head + newInner + tail + rest;
}

/** 删 frontmatter 单行字段 key(不存在原样返回)。 */
function clearFmKey(source: string, key: string): string {
  const fmMatch = source.match(/^(---\n)([\s\S]*?)(\n---\n?)/);
  if (!fmMatch) return source;
  const [, head, inner, tail] = fmMatch;
  const rest = source.slice(fmMatch[0].length);
  const lineRe = new RegExp(`^${key}\\s*:.*\\n?`, "m");
  if (!lineRe.test(inner)) return source;
  const cleaned = inner
    .replace(lineRe, "")
    .replace(/\n{2,}/g, "\n")
    .replace(/^\n/, "")
    .replace(/\n$/, "");
  return head + cleaned + tail + rest;
}

export class PrototypeError extends Error {
  constructor(message: string, public readonly httpStatus: number) {
    super(message);
    this.name = "PrototypeError";
  }
}
/** @deprecated 兼容旧名 — 用 PrototypeError */
export const PrototypeSubmitError = PrototypeError;

const ALLOWED_IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/** 读 screen 文件原文;不存在抛 404。 */
async function readScreenSource(productId: string, moduleName: string, screenId: string): Promise<{ filePath: string; source: string }> {
  const filePath = screenFilePath(productId, moduleName, screenId);
  try {
    return { filePath, source: await fs.readFile(filePath, "utf8") };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new PrototypeError(`screen not found: ${moduleName}/${screenId}`, 404);
    }
    throw e;
  }
}

/** 产品相对路径 → 绝对路径, 强制校验仍在产品目录内(防越界)。越界返回 null。 */
function resolveInProduct(productId: string, relPath: string): string | null {
  const productDir = dataPath("products", productId);
  const abs = path.resolve(productDir, relPath);
  if (abs !== productDir && !abs.startsWith(productDir + path.sep)) return null;
  return abs;
}

/** PM 侧: 把某 screen 标入出图队列。 返回 false = screen 文件不存在。 */
export async function setNeedsPrototype(
  productId: string,
  moduleName: string,
  screenId: string
): Promise<boolean> {
  const filePath = screenFilePath(productId, moduleName, screenId);
  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
  const next = setFmScalar(source, "needs_prototype", "true");
  if (next !== source) await fs.writeFile(filePath, next, "utf8");
  return true;
}

/**
 * 爆发期批量: 把所有"还没图、不在队列、不在待审"的 screen 一次性入队。
 * 返回入队的 "module/screenId" 列表。
 */
export async function queueAllMissing(productId: string): Promise<string[]> {
  const screens = await loadScreens(productId);
  const queued: string[] = [];
  for (const s of screens) {
    if (s.preview_image || s.pending_prototype || s.needs_prototype) continue;
    const ok = await setNeedsPrototype(productId, s.module, s.id);
    if (ok) queued.push(`${s.module}/${s.id}`);
  }
  return queued;
}

/**
 * 收 codex 客户端回传的原型图 → 写入【暂存待审】(pending_prototype), 不碰 preview_image:
 *   (1) screen 文件必须存在 + imagePath 必须是真实图片文件
 *   (2) 复制进 modules/<m>/screens/assets/<screenId>-<ts>.<ext>
 *   (3) 外科手术式写 pending_prototype + 清 needs_prototype
 */
export async function submitPrototype(opts: {
  productId: string;
  moduleName: string;
  screenId: string;
  imagePath: string;
}): Promise<{ pending_prototype: string }> {
  const { productId, moduleName, screenId, imagePath } = opts;
  const { filePath, source } = await readScreenSource(productId, moduleName, screenId);

  const ext = path.extname(imagePath).toLowerCase();
  if (!ALLOWED_IMAGE_EXT.has(ext)) {
    throw new PrototypeError(`不支持的图片格式: ${ext || "(无扩展名)"}`, 400);
  }
  let srcStat;
  try {
    srcStat = await fs.stat(imagePath);
  } catch {
    throw new PrototypeError(`源图不存在: ${imagePath}`, 400);
  }
  if (!srcStat.isFile()) throw new PrototypeError(`源路径不是文件: ${imagePath}`, 400);

  const assetsDir = dataPath("products", productId, "modules", moduleName, "screens", "assets");
  await fs.mkdir(assetsDir, { recursive: true });
  const filename = `${screenId}-${Date.now()}${ext}`;
  await fs.copyFile(imagePath, path.join(assetsDir, filename));

  const relStaged = `modules/${moduleName}/screens/assets/${filename}`;
  let next = setFmScalar(source, "pending_prototype", relStaged);
  next = clearFmKey(next, "needs_prototype");
  await fs.writeFile(filePath, next, "utf8");
  return { pending_prototype: relStaged };
}

/** 审核通过: pending_prototype 升为 preview_image(冻结), 清 pending。 */
export async function approvePrototype(
  productId: string,
  moduleName: string,
  screenId: string
): Promise<{ preview_image: string }> {
  const { filePath, source } = await readScreenSource(productId, moduleName, screenId);
  const pending = getFmScalar(source, "pending_prototype");
  if (!pending) throw new PrototypeError("该屏没有待审原型(pending_prototype 为空)", 400);
  let next = setFmScalar(source, "preview_image", pending);
  next = clearFmKey(next, "pending_prototype");
  await fs.writeFile(filePath, next, "utf8");
  return { preview_image: pending };
}

/**
 * 审核打回: 丢弃暂存图(删文件 + 清 pending_prototype);默认重新入队(needs_prototype)让 automation 再出一版。
 * preview_image(已通过的图)完全不动。
 */
export async function rejectPrototype(
  productId: string,
  moduleName: string,
  screenId: string,
  requeue = true
): Promise<{ requeued: boolean }> {
  const { filePath, source } = await readScreenSource(productId, moduleName, screenId);
  const pending = getFmScalar(source, "pending_prototype");
  if (!pending) throw new PrototypeError("该屏没有待审原型(pending_prototype 为空)", 400);
  let next = clearFmKey(source, "pending_prototype");
  if (requeue) next = setFmScalar(next, "needs_prototype", "true");
  await fs.writeFile(filePath, next, "utf8");
  // 删被打回的暂存图(从未通过, 删除安全)
  const abs = resolveInProduct(productId, pending);
  if (abs) await fs.rm(abs, { force: true }).catch(() => {});
  return { requeued: requeue };
}
