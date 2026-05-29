import { promises as fs } from "node:fs";
import path from "node:path";
import { dataPath } from "./fileReader";
import { loadScreens, screenFilePath } from "./screenLoader";

/**
 * 原型图轨(双轨设计 · 界面轨视觉产物)出图队列。
 *
 * 背景见 memory: codex-prototype-image-track。
 * codex CLI 不能文生图,只有 GUI 客户端的 image_gen 能;因此控制方向翻转 —
 * 客户端的 drain 会话主动 curl Atlas 拉队列 / 回传产物。本服务是队列的真源面:
 *   - needs_prototype=true 的 screen 即"待出图队列"(flag 是真源, 幂等可重启)
 *   - submit 回传后复制图入产品目录、写 preview_image、清 flag
 *
 * 一屏一闭环: image_gen 不返回结构化路径(靠扫最新 PNG 取绝对路径),
 * 故客户端必须 出一张立刻 submit 再出下一张, 否则多屏会拿错图。
 *
 * 写入策略: needs_prototype / preview_image 都是单行 scalar, 用外科手术式
 * frontmatter 改写(同 feedbackWriter.setNeedsRevision), **不 round-trip 整个文件** —
 * 避免重格式化 / 丢失 parser 不解析的 frontmatter 字段(如 split_suggestion)。
 */

export interface PendingPrototype {
  module: string;
  screenId: string;
  name: string;
  usecase_ids: string[];
  /** 已有预览图时回带 — 表示这是重出/迭代而非首出 */
  preview_image?: string;
}

/** 列出所有 needs_prototype=true 的 screen — 待出图队列。 */
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

/**
 * frontmatter 里设单行 scalar `key: value`(已存在则改值, 否则末尾追加)。
 * 无 frontmatter 块则插入一个。 仅适用单行 scalar 字段。
 */
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

/** frontmatter 里删除单行字段 key(不存在则原样返回)。 */
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

export class PrototypeSubmitError extends Error {
  constructor(message: string, public readonly httpStatus: number) {
    super(message);
    this.name = "PrototypeSubmitError";
  }
}

const ALLOWED_IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/**
 * 收 codex 客户端回传的原型图:
 *   (1) screen 文件必须存在 + imagePath 必须是真实图片文件
 *   (2) 复制进 modules/<m>/screens/assets/<screenId>-<ts>.<ext>
 *   (3) 外科手术式写 preview_image + 清 needs_prototype(不 round-trip 整文件)
 *
 * 任一前置失败抛 PrototypeSubmitError(带 httpStatus), 不写盘。
 */
export async function submitPrototype(opts: {
  productId: string;
  moduleName: string;
  screenId: string;
  imagePath: string;
}): Promise<{ preview_image: string }> {
  const { productId, moduleName, screenId, imagePath } = opts;
  const filePath = screenFilePath(productId, moduleName, screenId);
  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new PrototypeSubmitError(`screen not found: ${moduleName}/${screenId}`, 404);
    }
    throw e;
  }

  const ext = path.extname(imagePath).toLowerCase();
  if (!ALLOWED_IMAGE_EXT.has(ext)) {
    throw new PrototypeSubmitError(`不支持的图片格式: ${ext || "(无扩展名)"}`, 400);
  }
  let srcStat;
  try {
    srcStat = await fs.stat(imagePath);
  } catch {
    throw new PrototypeSubmitError(`源图不存在: ${imagePath}`, 400);
  }
  if (!srcStat.isFile()) throw new PrototypeSubmitError(`源路径不是文件: ${imagePath}`, 400);

  const assetsDir = dataPath("products", productId, "modules", moduleName, "screens", "assets");
  await fs.mkdir(assetsDir, { recursive: true });
  const filename = `${screenId}-${Date.now()}${ext}`;
  await fs.copyFile(imagePath, path.join(assetsDir, filename));

  const relPreview = `modules/${moduleName}/screens/assets/${filename}`;
  let next = setFmScalar(source, "preview_image", relPreview);
  next = clearFmKey(next, "needs_prototype");
  await fs.writeFile(filePath, next, "utf8");
  return { preview_image: relPreview };
}
