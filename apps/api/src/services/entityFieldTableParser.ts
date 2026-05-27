/**
 * 解析 derived entity .md 中的 `## 字段` markdown 表, 提取字段名集合 + 派生字段标记。
 *
 * 表头形态(yunkai-erp 实际样本):
 *   | 字段 | 类型 | 必填 | 约束 | 备注 | 来源 |
 *
 * 也兼容只有前 2 列的简化表(字段名 + 类型)。
 * 派生判定: 约束列含 "derived" 关键词 (大小写不敏感)。
 *
 * v0.1 用于 screenLoader 校验 entity_visibility 中字段名是否存在。
 */

export interface EntityField {
  name: string;
  /** 类型列原文 */
  type?: string;
  /** 约束列含 "derived" 关键字时为 true */
  derived: boolean;
}

export interface EntityFieldTable {
  fields: EntityField[];
  fieldNames: Set<string>;
  /** 派生字段名集合 */
  derivedFieldNames: Set<string>;
}

/**
 * 从 entity .md body 抓 `## 字段` 段下第一个 markdown 表。
 * 表不存在或解析失败 → 返回空表。
 */
export function parseEntityFieldTable(body: string): EntityFieldTable {
  const empty: EntityFieldTable = {
    fields: [],
    fieldNames: new Set(),
    derivedFieldNames: new Set()
  };

  const sectionRe = /^##\s+字段\s*$/m;
  const match = body.match(sectionRe);
  if (!match || match.index === undefined) return empty;

  const headingEnd = body.indexOf("\n", match.index);
  if (headingEnd < 0) return empty;
  const rest = body.slice(headingEnd + 1);
  // 截止到下一个同级或更高级标题
  const nextHeadingMatch = rest.match(/\n(##?\s+)/);
  const section = nextHeadingMatch && nextHeadingMatch.index !== undefined
    ? rest.slice(0, nextHeadingMatch.index)
    : rest;

  // 找连续的 `|...|` 行 — 取首个表
  const lines = section.split("\n");
  let tableStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
      tableStart = i;
      break;
    }
  }
  if (tableStart < 0) return empty;

  // 第二行通常是分隔行 (| --- | --- |), 跳过
  const dataLines: string[] = [];
  for (let i = tableStart; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith("|") || !line.endsWith("|")) break;
    if (i === tableStart) continue; // 表头
    if (/^\|\s*[-:|\s]+\|$/.test(line)) continue; // 分隔行
    dataLines.push(line);
  }

  const fields: EntityField[] = [];
  const fieldNames = new Set<string>();
  const derivedFieldNames = new Set<string>();

  for (const line of dataLines) {
    const cells = splitTableRow(line);
    if (cells.length === 0) continue;
    const rawName = (cells[0] ?? "").trim();
    if (!rawName) continue;
    // 跳过潜在的 sub-header 行(全是 --- 这类)
    if (/^[-:|\s]+$/.test(rawName)) continue;
    // 字段名可能带反引号: `name` → name
    const name = rawName.replace(/^`+|`+$/g, "").trim();
    if (!name) continue;
    const type = (cells[1] ?? "").trim() || undefined;
    const constraintCell = (cells[3] ?? "").trim().toLowerCase();
    // 派生检测: 约束列含 "derived" 关键字
    const derived = /\bderived\b/.test(constraintCell);
    fields.push({ name, ...(type ? { type } : {}), derived });
    fieldNames.add(name);
    if (derived) derivedFieldNames.add(name);
  }

  return { fields, fieldNames, derivedFieldNames };
}

/** 拆 `| a | b | c |` 为 ['a','b','c']。 转义的 `\|` 暂不支持(yunkai-erp 未见)。 */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
  const inner = trimmed.slice(1, -1);
  return inner.split("|").map((c) => c.trim());
}
