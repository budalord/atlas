import type {
  FeatureClue,
  FeatureFieldRow,
  FeaturePoint,
  FieldPermissionRow,
  StateTransitionRow
} from "@atlas/shared";
import { parseMarkdownWithFrontmatter } from "./markdownParser";
import { parseFeedbackSection, parseRevisionLog } from "./feedbackParser";

interface FeatureFrontmatter {
  id?: string;
  name?: string;
  module?: string;
  created_at?: string;
  last_refined_at?: string | null;
  added_in_phase?: string;
  added_at?: string;
  /** 规范层级标记(批次 1' 仅容错读取,不强校验) */
  spec_level?: number;
  /** 批次 1' · 反馈池非空时由后端自动写 true;Agent revise 后自己抹掉 */
  needs_revision?: boolean;
  /** 参与该功能点的角色 id 列表(来自 data/roles.yml 的 id,kebab-case)。
   *  非数组当空,id 不在 registry 中由 server 写盘前校验,parse 阶段透传不丢弃。 */
  roles?: unknown;
  /** 管理模块 id(三层架构中层)。非字符串当空。 */
  module_group?: unknown;
  /** 中形态:操作的实体规范名清单(PascalCase)。非数组当空。 */
  entities_touched?: unknown;
  /** 中形态:归属层(org / campus / follows:Entity / shared)。非字符串当空。 */
  ownership?: unknown;
}

const VALID_ADDED_PHASES = new Set(["planning", "in-progress", "live"]);

/**
 * 解析单个功能点 markdown 文件。
 *
 * 期望结构(见 ATLAS-SPEC.md):
 *   ---frontmatter---
 *   # <name>
 *   ## 描述
 *   <description body>
 *   ## 线索池
 *   ### Pending
 *   - (YYYY-MM-DD) ...
 *   ### Resolved
 *   - (YYYY-MM-DD) ...
 *
 * 缺失任何 section 都不抛错,返回空字符串/空数组。
 */
export function parseFeatureMarkdown(idFromFile: string, source: string): FeaturePoint {
  const parsed = parseMarkdownWithFrontmatter<FeatureFrontmatter>(source, {});
  const fm = parsed.frontmatter;
  const body = parsed.body;

  const id = fm.id?.trim() || idFromFile;
  const name = fm.name?.trim() || body.match(/^#\s+(.+)$/m)?.[1]?.trim() || id;
  const module = fm.module?.trim() || "";
  const created_at = fm.created_at?.trim() || "";
  const last_refined_at = fm.last_refined_at?.trim() || null;
  const addedPhaseRaw = fm.added_in_phase?.trim();
  const added_in_phase = addedPhaseRaw && VALID_ADDED_PHASES.has(addedPhaseRaw)
    ? (addedPhaseRaw as "planning" | "in-progress" | "live")
    : undefined;
  const added_at = fm.added_at?.trim() || undefined;

  const description = extractSection(body, "## 描述");
  const cluePoolSection = extractSection(body, "## 线索池");
  const pendingRaw = extractSection(cluePoolSection, "### Pending");
  const resolvedRaw = extractSection(cluePoolSection, "### Resolved");

  // 批次 1' · 反馈池(段不存在 → 空数组) + 修订记录(只读)
  const feedback = parseFeedbackSection(body);
  const revision_log = parseRevisionLog(body);
  const spec_level = typeof fm.spec_level === "number" ? fm.spec_level : undefined;
  const needs_revision = fm.needs_revision === true ? true : undefined;
  const roles = normalizeRoles(fm.roles);
  const module_group = typeof fm.module_group === "string" && fm.module_group.trim().length > 0
    ? fm.module_group.trim()
    : undefined;
  const entities_touched = normalizeEntitiesTouched(fm.entities_touched);
  const ownership = typeof fm.ownership === "string" && fm.ownership.trim().length > 0
    ? fm.ownership.trim()
    : undefined;

  // 重形态三段 - 全部容错,缺段 / 表格坏 → undefined
  const fieldsSection = extractSection(body, "## 字段清单");
  const fields = fieldsSection ? parseFieldsTable(fieldsSection) : undefined;
  const stateSection = extractSection(body, "## 状态转移");
  const state_transitions = stateSection ? parseStateTransitionsTable(stateSection) : undefined;
  const fieldPermSection = extractSection(body, "## 字段权限");
  const field_permissions = fieldPermSection ? parseFieldPermissionsTable(fieldPermSection) : undefined;

  return {
    id,
    name,
    module,
    created_at,
    last_refined_at,
    description,
    clues: {
      pending: parseClueLines(pendingRaw),
      resolved: parseClueLines(resolvedRaw)
    },
    markdown: body,
    feedback,
    revision_log,
    ...(added_in_phase ? { added_in_phase } : {}),
    ...(added_at ? { added_at } : {}),
    ...(spec_level !== undefined ? { spec_level } : {}),
    ...(needs_revision ? { needs_revision } : {}),
    ...(roles.length > 0 ? { roles } : {}),
    ...(module_group ? { module_group } : {}),
    ...(entities_touched.length > 0 ? { entities_touched } : {}),
    ...(ownership ? { ownership } : {}),
    ...(fields && fields.length > 0 ? { fields } : {}),
    ...(state_transitions && state_transitions.length > 0 ? { state_transitions } : {}),
    ...(field_permissions && field_permissions.length > 0 ? { field_permissions } : {})
  };
}

/** 容错 normalize entities_touched: 非数组 → 空; 非字符串项过滤; 去重保序;
 *  PascalCase 弱校验(首字母大写),不合规仍透传不丢弃。 */
function normalizeEntitiesTouched(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * 解析 `## 字段清单` 段(5 列固定表格)。容错:
 *   - 表头列数不对 → undefined
 *   - 某行列数不对 → 跳过该行,不报错
 */
function parseFieldsTable(section: string): FeatureFieldRow[] | undefined {
  const rows = parseMarkdownTable(section);
  if (!rows || rows.length === 0) return undefined;
  // 验证表头列数 — 期望 5 列
  const header = rows[0];
  if (header.length !== 5) return undefined;
  const out: FeatureFieldRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length !== 5) continue;
    out.push({
      name: r[0],
      type: r[1],
      required: r[2] === "✓" || r[2].toLowerCase() === "true",
      constraint: r[3],
      note: r[4]
    });
  }
  return out;
}

/**
 * 解析 `## 状态转移` 段(4 列固定表格 from | to | 触发 | 角色)。
 */
function parseStateTransitionsTable(section: string): StateTransitionRow[] | undefined {
  const rows = parseMarkdownTable(section);
  if (!rows || rows.length === 0) return undefined;
  const header = rows[0];
  if (header.length !== 4) return undefined;
  const out: StateTransitionRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length !== 4) continue;
    out.push({ from: r[0], to: r[1], trigger: r[2], role: r[3] });
  }
  return out;
}

/**
 * 解析 `## 字段权限` 段(变长列表格:第 1 列是 field 名,其余列是 role id)。
 * 头行: `| 字段 | role1 | role2 | ... |`
 */
function parseFieldPermissionsTable(section: string): FieldPermissionRow[] | undefined {
  const rows = parseMarkdownTable(section);
  if (!rows || rows.length < 2) return undefined;
  const header = rows[0];
  if (header.length < 2) return undefined;
  const roleIds = header.slice(1).map((s) => s.trim());
  const out: FieldPermissionRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length !== header.length) continue;
    const permissions: Record<string, "RW" | "R" | "-"> = {};
    for (let j = 0; j < roleIds.length; j++) {
      const cell = r[j + 1].trim();
      if (cell === "RW" || cell === "R" || cell === "-") {
        permissions[roleIds[j]] = cell;
      }
    }
    out.push({ field: r[0], permissions });
  }
  return out;
}

/**
 * 通用 markdown 表格解析。返回 string[][],第一行是表头。
 * 忽略分隔行 (---|---|...)。
 */
function parseMarkdownTable(section: string): string[][] | null {
  const lines = section.split("\n").map((l) => l.trim());
  const rows: string[][] = [];
  for (const line of lines) {
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    // 跳过分隔行(全是 - 和 |)
    if (/^\|[\s\-\|:]+\|$/.test(line)) continue;
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    rows.push(cells);
  }
  return rows.length > 0 ? rows : null;
}

/** 容错地把 frontmatter.roles 规整为 string[]:非数组 → 空;非字符串项过滤;去重保序。 */
function normalizeRoles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * 解析单条线索行。约定格式: `- (YYYY-MM-DD) [task:tid]? [issue:#N|url]? content`。
 * 标记可选,出现位置在日期之后、正文之前;识别后从 content 中剥离。
 * 非匹配的列表项忽略;非列表行也忽略。
 */
export function parseClueLines(section: string): FeatureClue[] {
  const clueRe = /^-\s*\((\d{4}-\d{2}-\d{2})\)\s*(.+)$/;
  return section
    .split("\n")
    .map((line) => line.trim().match(clueRe))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => {
      const date = m[1];
      let rest = m[2].trim();
      let task_id: string | undefined;
      let issue_url: string | undefined;
      // 反复抽取前缀标记,直到 content 不再以标记开头
      while (true) {
        const taskMatch = rest.match(/^\[task:([a-zA-Z0-9_\-]+)\]\s*/);
        if (taskMatch) {
          task_id = taskMatch[1];
          rest = rest.slice(taskMatch[0].length);
          continue;
        }
        const issueMatch = rest.match(/^\[issue:([^\]]+)\]\s*/);
        if (issueMatch) {
          issue_url = issueMatch[1];
          rest = rest.slice(issueMatch[0].length);
          continue;
        }
        break;
      }
      const out: FeatureClue = { date, content: rest.trim() };
      if (task_id) out.task_id = task_id;
      if (issue_url) out.issue_url = issue_url;
      return out;
    });
}

/**
 * 提取 section。同时支持 H2/H3 等任意层级(根据 heading 前缀决定下一个同级标题)。
 * 与 markdownParser.ts 的 extractSection 共用同套思路,但本处独立实现以避免循环依赖。
 */
function extractSection(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const level = heading.match(/^#+/)?.[0] ?? "#";
  const nextHeading = `\\n${level}\\s+`;
  // 注意:行尾用 `[^\n]*\n` 而不是 `\s*\n` —— 后者会贪婪吃掉随后的空行,
  // 导致下一节的 "\n###" 边界标记被一并消耗,匹配跨过去捕错内容。
  const match = markdown.match(
    new RegExp(`${escaped}[^\\n]*\\n([\\s\\S]*?)(?=${nextHeading}|$)`)
  );
  return match?.[1]?.trim() ?? "";
}

export function feature_extractSection(markdown: string, heading: string): string {
  return extractSection(markdown, heading);
}
