import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { GlobalFeedback, GlobalFeedbackScope } from "@atlas/shared";
import {
  globalFeedbackPath,
  parseGlobalFeedbackFile,
  serializeGlobalFeedbackFile
} from "./globalFeedbackParser";

export class GlobalFeedbackWriterError extends Error {
  constructor(message: string, public readonly httpStatus: number) {
    super(message);
    this.name = "GlobalFeedbackWriterError";
  }
}

/** 生成 gfb-<YYYYMMDD>-<6 位 hex>。 */
export function generateGlobalFeedbackId(today: string): string {
  const ymd = today.replace(/-/g, "");
  const rand = randomBytes(4).toString("hex").slice(0, 6);
  return `gfb-${ymd}-${rand}`;
}

/**
 * 在 GLOBAL-FEEDBACK.md 追加一条全局需求。文件不存在时自动创建。
 * 严格 4 步:read → parse → mutate → serialize+write。
 */
export async function appendGlobalFeedback(
  productId: string,
  scope: GlobalFeedbackScope,
  content: string,
  providedId?: string
): Promise<GlobalFeedback> {
  const today = new Date().toISOString().slice(0, 10);
  const data = await parseGlobalFeedbackFile(productId);

  const existingIds = new Set<string>([
    ...data.feature.map((f) => f.id),
    ...data.entity.map((f) => f.id),
    ...data.prototype.map((f) => f.id)
  ]);

  let id = providedId ?? generateGlobalFeedbackId(today);
  while (existingIds.has(id)) {
    id = generateGlobalFeedbackId(today);
  }

  const entry: GlobalFeedback = { id, date: today, scope, content };
  data[scope] = [...data[scope], entry];

  await writeFileEnsuringDir(productId, serializeGlobalFeedbackFile(data, today));
  return entry;
}

/**
 * 按 id 删除一条全局需求(扫三段)。找不到 id → 抛 404。
 */
export async function deleteGlobalFeedback(productId: string, id: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const data = await parseGlobalFeedbackFile(productId);

  let removed = false;
  for (const scope of ["feature", "entity", "prototype"] as const) {
    const before = data[scope].length;
    data[scope] = data[scope].filter((f) => f.id !== id);
    if (data[scope].length !== before) removed = true;
  }

  if (!removed) {
    throw new GlobalFeedbackWriterError(`全局需求 ${id} 不存在`, 404);
  }

  await writeFileEnsuringDir(productId, serializeGlobalFeedbackFile(data, today));
}

async function writeFileEnsuringDir(productId: string, contents: string): Promise<void> {
  const filePath = globalFeedbackPath(productId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
}
