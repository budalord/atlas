import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { UseCase } from "@atlas/shared";
import {
  dataPath,
  listDirectories,
  listMarkdownFiles,
  pathExists,
  readTextFile
} from "./fileReader";
import { parseMarkdownWithFrontmatter } from "./markdownParser";
import { parseFeedbackSection } from "./feedbackParser";

/**
 * UseCase loader · 业务场景 (`modules/<m>/usecases/<scenario>.md`)。
 *
 * 见 docs/usecase-contract.md。
 * 跨所有 module 扫描 usecases/ 子目录。
 * **不缓存** (规则 5)。
 */

interface UseCaseFrontmatter {
  id?: unknown;
  function_id?: unknown;
  actor_id?: unknown;
  entity_ids?: unknown;
  precondition?: unknown;
  postcondition?: unknown;
  source?: unknown;
  /** 反馈池非空时由 feedbackWriter 自动写 true;Agent revise 完毕自己删。 */
  needs_revision?: unknown;
  /** agent revise 时若检测到拆分信号写入;用户在 UseCaseModal 上处理后清除。 */
  split_suggestion?: unknown;
}

const VALID_SOURCES = new Set(["user_input", "agent_suggested", "inferred_from_function_name"]);

export async function loadUseCases(productId: string): Promise<UseCase[]> {
  if (!(await pathExists("products", productId, "modules"))) return [];
  let modules: string[];
  try {
    modules = await listDirectories("products", productId, "modules");
  } catch {
    return [];
  }
  const out: UseCase[] = [];
  for (const mod of modules) {
    if (!(await pathExists("products", productId, "modules", mod, "usecases"))) continue;
    let files: string[];
    try {
      files = await listMarkdownFiles("products", productId, "modules", mod, "usecases");
    } catch {
      continue;
    }
    for (const fname of files) {
      const source = await readTextFile(
        "products",
        productId,
        "modules",
        mod,
        "usecases",
        fname
      );
      if (!source) continue;
      const uc = parseUseCase(mod, fname.replace(/\.md$/, ""), source);
      if (uc) out.push(uc);
    }
  }
  // 按 module / function_id / id 排序, 保持稳定
  out.sort((a, b) =>
    a.module.localeCompare(b.module) ||
    a.function_id.localeCompare(b.function_id) ||
    a.id.localeCompare(b.id)
  );
  return out;
}

export async function loadUseCase(
  productId: string,
  moduleName: string,
  usecaseId: string
): Promise<UseCase | null> {
  const source = await readTextFile(
    "products",
    productId,
    "modules",
    moduleName,
    "usecases",
    `${usecaseId}.md`
  );
  if (source === null) return null;
  return parseUseCase(moduleName, usecaseId, source);
}

/**
 * 通过 function_id 找该 function 的所有 usecases (loader 没有索引, 全扫一遍)。
 */
export async function loadUseCasesForFunction(
  productId: string,
  functionId: string
): Promise<UseCase[]> {
  const all = await loadUseCases(productId);
  return all.filter((u) => u.function_id === functionId);
}

export function parseUseCase(
  moduleName: string,
  idFromFile: string,
  source: string
): UseCase | null {
  const parsed = parseMarkdownWithFrontmatter<UseCaseFrontmatter>(source, {});
  const fm = parsed.frontmatter;
  const id = typeof fm.id === "string" && fm.id.trim().length > 0
    ? fm.id.trim()
    : idFromFile;
  const function_id = typeof fm.function_id === "string" ? fm.function_id.trim() : "";
  const actor_id = typeof fm.actor_id === "string" ? fm.actor_id.trim() : "";
  if (!function_id || !actor_id) return null; // 缺关键字段, 视为损坏
  const entity_ids_raw = fm.entity_ids;
  const entity_ids = Array.isArray(entity_ids_raw)
    ? entity_ids_raw.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter((x) => x.length > 0)
    : undefined;
  const precondition = typeof fm.precondition === "string" && fm.precondition.trim().length > 0
    ? fm.precondition.trim()
    : undefined;
  const postcondition = typeof fm.postcondition === "string" && fm.postcondition.trim().length > 0
    ? fm.postcondition.trim()
    : undefined;
  const sourceRaw = typeof fm.source === "string" ? fm.source.trim() : "";
  const source$ = VALID_SOURCES.has(sourceRaw)
    ? (sourceRaw as UseCase["source"])
    : undefined;
  const needs_revision = fm.needs_revision === true;
  const split_suggestion = typeof fm.split_suggestion === "string" && fm.split_suggestion.trim().length > 0
    ? fm.split_suggestion.trim()
    : undefined;
  const body = parsed.body.trim();
  const feedback = parseFeedbackSection(body);
  return {
    id,
    module: moduleName,
    function_id,
    actor_id,
    ...(entity_ids && entity_ids.length > 0 ? { entity_ids } : {}),
    ...(precondition ? { precondition } : {}),
    ...(postcondition ? { postcondition } : {}),
    ...(source$ ? { source: source$ } : {}),
    ...(needs_revision ? { needs_revision } : {}),
    ...(split_suggestion ? { split_suggestion } : {}),
    ...(feedback.length > 0 ? { feedback } : {}),
    body
  };
}

export function usecasePath(productId: string, moduleName: string, usecaseId: string): string {
  return dataPath("products", productId, "modules", moduleName, "usecases", `${usecaseId}.md`);
}

export async function writeUseCase(productId: string, uc: UseCase): Promise<void> {
  const fmObj: Record<string, unknown> = {
    id: uc.id,
    function_id: uc.function_id,
    actor_id: uc.actor_id
  };
  if (uc.entity_ids && uc.entity_ids.length > 0) fmObj.entity_ids = uc.entity_ids;
  if (uc.precondition) fmObj.precondition = uc.precondition;
  if (uc.postcondition) fmObj.postcondition = uc.postcondition;
  if (uc.source) fmObj.source = uc.source;
  if (uc.needs_revision) fmObj.needs_revision = true;
  if (uc.split_suggestion) fmObj.split_suggestion = uc.split_suggestion;
  const fmText = YAML.stringify(fmObj).trim();
  const body = uc.body.trim();
  const content = `---\n${fmText}\n---\n\n${body}\n`;
  const dir = path.dirname(usecasePath(productId, uc.module, uc.id));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(usecasePath(productId, uc.module, uc.id), content, "utf8");
}

export async function deleteUseCase(
  productId: string,
  moduleName: string,
  usecaseId: string
): Promise<boolean> {
  const filePath = usecasePath(productId, moduleName, usecaseId);
  try {
    await fs.unlink(filePath);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
