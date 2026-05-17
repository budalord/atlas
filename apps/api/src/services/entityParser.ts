import type { DecisionSpec, EntitySpec, FieldSpec, RelationSpec, FieldRequired } from "@atlas/shared";
import { parseMarkdownWithFrontmatter } from "./markdownParser";
import { parseFeedbackSection, parseRevisionLog } from "./feedbackParser";

interface EntityFrontmatter {
  added_in_phase?: string;
  added_at?: string;
  /** 规范层级标记(批次 1' 仅容错读取,不强校验) */
  spec_level?: number;
  /** 批次 1' · 反馈池非空时由后端自动写 true;Agent revise 后自己抹掉 */
  needs_revision?: boolean;
}

const VALID_ADDED_PHASES = new Set(["planning", "in-progress", "live"]);

/**
 * 解析单个实体 markdown 文件,识别字段表、关系列表、决策列表,并标记 TBD。
 *
 * markdown 约定:
 *   # <实体名>
 *   ## 字段
 *   | 字段名 | 类型 | 必填 | 约束 | 备注 |
 *   |  ...   |  ...  | ...  | ...  | ...  |
 *   ## 关系
 *   - N:1 → 班级 (class)
 *   - N:1 → 家长 (parent) [TBD]
 *   ## 决策
 *   - **标题**: 理由
 *   - **TBD - 某决策**: 理由
 *
 * TBD 检测规则:
 *   - 字段「必填」列等于 "TBD"(大小写不敏感)
 *   - 关系行包含 "[TBD]"(大小写不敏感)
 *   - 决策标题以 "TBD -" / "TBD:" 开头,或行内含 "[TBD]"
 *   - 字段备注里含 "[TBD]" / 以 "TBD" 开头也算 is_tbd=true
 */
export function parseEntityMarkdown(
  id: string,
  source: string,
  module: string | null
): EntitySpec {
  const parsed = parseMarkdownWithFrontmatter<EntityFrontmatter>(source, {});
  const fm = parsed.frontmatter;
  const body = parsed.body;
  const name = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? id;
  const fields = parseFieldTable(extractSection(body, "## 字段"));
  const relations = parseRelationList(extractSection(body, "## 关系"));
  const decisions = parseDecisionList(extractSection(body, "## 决策"));

  const addedPhaseRaw = fm.added_in_phase?.trim();
  const added_in_phase = addedPhaseRaw && VALID_ADDED_PHASES.has(addedPhaseRaw)
    ? (addedPhaseRaw as "planning" | "in-progress" | "live")
    : undefined;
  const added_at = fm.added_at?.trim() || undefined;

  // 批次 1' · 反馈池(段不存在 → 空数组) + 修订记录(只读)
  const feedback = parseFeedbackSection(body);
  const revision_log = parseRevisionLog(body);
  const spec_level = typeof fm.spec_level === "number" ? fm.spec_level : undefined;
  const needs_revision = fm.needs_revision === true ? true : undefined;

  return {
    id,
    name,
    module,
    fields,
    relations,
    decisions,
    markdown: body,
    feedback,
    revision_log,
    ...(added_in_phase ? { added_in_phase } : {}),
    ...(added_at ? { added_at } : {}),
    ...(spec_level !== undefined ? { spec_level } : {}),
    ...(needs_revision ? { needs_revision } : {})
  };
}

function extractSection(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const level = heading.startsWith("##") ? "##" : "#";
  const nextHeading = level === "##" ? "\\n##\\s+" : "\\n#\\s+";
  const match = markdown.match(new RegExp(`${escaped}\\s*\\n([\\s\\S]*?)(?=${nextHeading}|$)`));
  return match?.[1]?.trim() ?? "";
}

function parseFieldTable(section: string): FieldSpec[] {
  const rows = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));

  if (rows.length === 0) {
    return [];
  }

  // 跳过表头与分隔行(若存在)
  const dataRows = rows.filter((row, idx) => {
    if (idx === 0) return false; // 表头
    // 分隔行只含 |, -, :, 空格
    if (/^\|[\s\-:|]+\|$/.test(row)) return false;
    return true;
  });

  return dataRows.map((row) => {
    const cells = row
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());

    const requiredRaw = (cells[2] ?? "").toUpperCase();
    let required: FieldRequired;
    if (requiredRaw === "TBD") required = "TBD";
    else if (requiredRaw === "是" || requiredRaw === "YES" || requiredRaw === "Y") required = "yes";
    else required = "no";

    const notes = cells[4] ?? "";
    const is_tbd =
      required === "TBD" ||
      /\[TBD\]/i.test(notes) ||
      /^TBD\b/i.test(notes.trim());

    return {
      name: cells[0] ?? "",
      type: cells[1] ?? "",
      required,
      constraint: cells[3] ?? "",
      notes,
      is_tbd
    };
  });
}

function parseRelationList(section: string): RelationSpec[] {
  const lines = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-\s+/, ""));

  return lines.map((line) => {
    const is_tbd = /\[TBD\]/i.test(line);
    // 形如:  N:1 → 班级 (class)   或   N:1 -> 班级 (class) [TBD]   或自由文本
    const arrowMatch = line.match(/^(\S+)\s*(?:→|->)\s*(.+?)(?:\s*\[TBD\])?\s*$/i);
    if (arrowMatch) {
      return {
        cardinality: arrowMatch[1],
        target: arrowMatch[2].trim(),
        note: "",
        is_tbd
      };
    }
    // 回落:整行当 target
    return {
      cardinality: "",
      target: line.replace(/\[TBD\]/gi, "").trim(),
      note: "",
      is_tbd
    };
  });
}

function parseDecisionList(section: string): DecisionSpec[] {
  // 每条决策是一个顶层 bullet (- ),其下可能跟若干续行(以空格缩进或非 "- " 开头)。
  const lines = section.split("\n");
  const decisions: DecisionSpec[] = [];
  let current: { raw: string[] } | null = null;

  for (const line of lines) {
    if (/^-\s+/.test(line)) {
      if (current) {
        decisions.push(buildDecision(current.raw));
      }
      current = { raw: [line.replace(/^-\s+/, "")] };
    } else if (current && line.trim().length > 0) {
      current.raw.push(line.trim());
    }
  }
  if (current) {
    decisions.push(buildDecision(current.raw));
  }
  return decisions;
}

function buildDecision(rawLines: string[]): DecisionSpec {
  const joined = rawLines.join(" ").trim();
  // 优先匹配  **标题**: 理由   或   **标题**：理由
  const boldMatch = joined.match(/^\*\*(.+?)\*\*\s*[:：]\s*(.*)$/);
  let title: string;
  let rationale: string;
  if (boldMatch) {
    title = boldMatch[1].trim();
    rationale = boldMatch[2].trim();
  } else {
    // 回落:第一段当标题,其余当 rationale;若只有一行则全当标题
    const colonMatch = joined.match(/^(.+?)\s*[:：]\s*(.+)$/);
    if (colonMatch) {
      title = colonMatch[1].trim();
      rationale = colonMatch[2].trim();
    } else {
      title = joined;
      rationale = "";
    }
  }
  const is_tbd = /^TBD\b/i.test(title) || /\[TBD\]/i.test(title) || /\[TBD\]/i.test(rationale);
  return { title, rationale, is_tbd };
}
