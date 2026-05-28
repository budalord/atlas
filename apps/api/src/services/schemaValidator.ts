import { parseFeatureMarkdown } from "./featureParser";
import { parseEntityMarkdown } from "./entityParser";
import { parseUseCase } from "./usecaseLoader";
import { parseScreen } from "./screenLoader";
import { parseActor } from "./actorLoader";
import { parseMarkdownWithFrontmatter } from "./markdownParser";

/**
 * v0.2c §5.3: 在现有 exception-free parser 之上包一层硬规则校验, 给 agent 用的
 * /api/agent/validate/<scope> 端点服务。 失败时返结构化 errors[] 而非抛, agent
 * 看 errors 自修。
 *
 * 设计原则: 只校验 contract 文件里写明的硬规则 (frontmatter 必填 / 命名约定 /
 * 段落必须存在 / 反馈池处理义务), 不重复 parser 已经容错的部分 (yaml 合法性 /
 * 引用完整性). 引用完整性留给 validateScreen() 等业务级 validator 单独做。
 */

export interface ValidationError {
  severity: "error" | "warn";
  code: string;
  path: string; // 字段路径, e.g. "frontmatter.id" / "section.反馈池"
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

const KEBAB_CASE = /^[a-z][a-z0-9-]*$/;
const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;
const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

function err(code: string, path: string, message: string, severity: "error" | "warn" = "error"): ValidationError {
  return { severity, code, path, message };
}

/** feature.md 硬规则: frontmatter id/name/module 必填, id kebab-case, 反馈池有内容时 needs_revision=true. */
export function validateFeatureMarkdown(idFromFile: string, source: string): ValidationResult {
  const errors: ValidationError[] = [];
  const fp = parseFeatureMarkdown(idFromFile, source);
  const raw = parseMarkdownWithFrontmatter<Record<string, unknown>>(source, {});
  const fm = raw.frontmatter;

  if (!fm.id || typeof fm.id !== "string" || !String(fm.id).trim()) {
    errors.push(err("frontmatter.id.missing", "frontmatter.id", "feature.md 的 frontmatter 必须有 id 字段 (非空字符串)"));
  } else if (!KEBAB_CASE.test(String(fm.id).trim())) {
    errors.push(err("frontmatter.id.naming", "frontmatter.id", `feature id "${fm.id}" 必须 kebab-case (小写字母+数字+连字符开头, 不允许大写/下划线)`));
  }
  if (!fm.name || typeof fm.name !== "string" || !String(fm.name).trim()) {
    errors.push(err("frontmatter.name.missing", "frontmatter.name", "feature.md 的 frontmatter 必须有 name 字段"));
  }
  if (!fm.module || typeof fm.module !== "string" || !String(fm.module).trim()) {
    errors.push(err("frontmatter.module.missing", "frontmatter.module", "feature.md 的 frontmatter 必须有 module 字段"));
  } else if (!KEBAB_CASE.test(String(fm.module).trim())) {
    errors.push(err("frontmatter.module.naming", "frontmatter.module", `module "${fm.module}" 必须 kebab-case`));
  }

  // 反馈池处理义务: 反馈池非空 + needs_revision 未标 → revise agent 漏改
  if (fp.feedback && fp.feedback.length > 0 && fm.needs_revision !== true) {
    errors.push(err("feedback.unmarked", "frontmatter.needs_revision", "反馈池非空时 frontmatter.needs_revision 必须为 true", "warn"));
  }
  // 反过来: revise 后 needs_revision 应已删 + 反馈池清空
  if (fm.needs_revision === true && (!fp.feedback || fp.feedback.length === 0)) {
    errors.push(err("feedback.stale_flag", "frontmatter.needs_revision", "反馈池已空, needs_revision 标记应删除", "warn"));
  }

  return { ok: errors.filter((e) => e.severity === "error").length === 0, errors };
}

/** entity.md 硬规则: PascalCase 文件名, frontmatter 有 name 字段 (派生 entity 必填). */
export function validateEntityMarkdown(idFromFile: string, source: string): ValidationResult {
  const errors: ValidationError[] = [];
  if (!PASCAL_CASE.test(idFromFile)) {
    errors.push(err("file.naming", "filename", `entity 文件名 "${idFromFile}" 必须 PascalCase (首字母大写)`));
  }
  parseEntityMarkdown(idFromFile, source, null); // 触发 parse, 当前不抛
  const raw = parseMarkdownWithFrontmatter<Record<string, unknown>>(source, {});
  const fm = raw.frontmatter;

  if (!fm.name || typeof fm.name !== "string" || !String(fm.name).trim()) {
    errors.push(err("frontmatter.name.missing", "frontmatter.name", "entity.md 的 frontmatter 必须有 name 字段"));
  } else if (!PASCAL_CASE.test(String(fm.name).trim())) {
    errors.push(err("frontmatter.name.naming", "frontmatter.name", `entity name "${fm.name}" 必须 PascalCase`, "warn"));
  }
  return { ok: errors.filter((e) => e.severity === "error").length === 0, errors };
}

/** usecase.md 硬规则: frontmatter id (kebab-case) + name + function_id + actor_id. */
export function validateUseCaseMarkdown(idFromFile: string, moduleName: string, source: string): ValidationResult {
  const errors: ValidationError[] = [];
  const uc = parseUseCase(idFromFile, moduleName, source);
  if (!uc) {
    errors.push(err("parse.failed", "frontmatter", "usecase.md 解析失败 — 检查 frontmatter 是否合法 yaml"));
    return { ok: false, errors };
  }
  if (!KEBAB_CASE.test(uc.id)) {
    errors.push(err("frontmatter.id.naming", "frontmatter.id", `usecase id "${uc.id}" 必须 kebab-case`));
  }
  // UseCase 无 name 字段 (用 id 做唯一识别), 跳过 name 校验
  if (!uc.function_id || !uc.function_id.trim()) {
    errors.push(err("frontmatter.function_id.missing", "frontmatter.function_id", "usecase.md 必须有 function_id (关联 feature)"));
  }
  if (!uc.actor_id || !uc.actor_id.trim()) {
    errors.push(err("frontmatter.actor_id.missing", "frontmatter.actor_id", "usecase.md 必须有 actor_id"));
  }
  return { ok: errors.filter((e) => e.severity === "error").length === 0, errors };
}

/** screen.md 硬规则: frontmatter id (kebab-case) + name + module + usecase_ids 数组. */
export function validateScreenMarkdown(idFromFile: string, moduleName: string, source: string): ValidationResult {
  const errors: ValidationError[] = [];
  const sc = parseScreen(idFromFile, moduleName, source);
  if (!sc) {
    errors.push(err("parse.failed", "frontmatter", "screen.md 解析失败 — 检查 frontmatter 是否合法 yaml"));
    return { ok: false, errors };
  }
  if (!KEBAB_CASE.test(sc.id)) {
    errors.push(err("frontmatter.id.naming", "frontmatter.id", `screen id "${sc.id}" 必须 kebab-case`));
  }
  if (!sc.name || !sc.name.trim()) {
    errors.push(err("frontmatter.name.missing", "frontmatter.name", "screen.md 必须有 name"));
  }
  if (!sc.module || !sc.module.trim()) {
    errors.push(err("frontmatter.module.missing", "frontmatter.module", "screen.md 必须有 module"));
  }
  if (!Array.isArray(sc.usecase_ids) || sc.usecase_ids.length === 0) {
    errors.push(err("frontmatter.usecase_ids.missing", "frontmatter.usecase_ids", "screen.md 必须有非空 usecase_ids 数组 (一屏对应至少一个 usecase)"));
  }
  if (!sc.entity_visibility || Object.keys(sc.entity_visibility).length === 0) {
    errors.push(err("frontmatter.entity_visibility.missing", "frontmatter.entity_visibility", "screen.md 必须有 entity_visibility 配置 (至少一个 entity)", "warn"));
  }
  return { ok: errors.filter((e) => e.severity === "error").length === 0, errors };
}

/** actor.md 硬规则: frontmatter id (kebab-case) + name. */
export function validateActorMarkdown(idFromFile: string, source: string): ValidationResult {
  const errors: ValidationError[] = [];
  const ac = parseActor(idFromFile, source);
  if (!ac) {
    errors.push(err("parse.failed", "frontmatter", "actor.md 解析失败"));
    return { ok: false, errors };
  }
  if (!KEBAB_CASE.test(ac.id)) {
    errors.push(err("frontmatter.id.naming", "frontmatter.id", `actor id "${ac.id}" 必须 kebab-case`));
  }
  if (!ac.name || !ac.name.trim()) {
    errors.push(err("frontmatter.name.missing", "frontmatter.name", "actor.md 必须有 name"));
  }
  // SNAKE_CASE 校验保留给字段层 (现版本 actor 无字段表), 这里 mark 一下避免 lint dead-code
  void SNAKE_CASE;
  return { ok: errors.filter((e) => e.severity === "error").length === 0, errors };
}

export type Scope = "feature" | "entity" | "usecase" | "screen" | "actor";

/** 统一 dispatcher (给 routes/agentApi 用). */
export function validateByScope(
  scope: Scope,
  idFromFile: string,
  source: string,
  moduleName?: string
): ValidationResult {
  switch (scope) {
    case "feature": return validateFeatureMarkdown(idFromFile, source);
    case "entity": return validateEntityMarkdown(idFromFile, source);
    case "usecase": return validateUseCaseMarkdown(idFromFile, moduleName ?? "", source);
    case "screen": return validateScreenMarkdown(idFromFile, moduleName ?? "", source);
    case "actor": return validateActorMarkdown(idFromFile, source);
  }
}
