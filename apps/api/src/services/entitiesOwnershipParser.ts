import type {
  EntitiesOwnershipData,
  OwnershipEntityRow,
  OwnershipGroupRow,
  OwnershipRow
} from "@atlas/shared";

/**
 * 解析 ENTITIES-OWNERSHIP.md。
 *
 * 形态(docs/entities-ownership-contract.md):
 *
 *   > Derived from <source>...    (可选 leading comment)
 *
 *   # 实体的机构 / 校区归属清单
 *
 *   <可选 preamble 段落>
 *
 *   ## 完整归属清单
 *
 *   | 实体 | 归属 | 维护权限 | 备注 |
 *   |------|------|----------|------|
 *   | **D 字典层** |  |  |  |
 *   | MajorCategory(大类) | 机构层 | 校长 | 影响业务结构 |
 *   ...
 *
 *   ## 关键派生关系
 *   <自由 markdown>
 *
 *   ## 跨校区操作的处理原则
 *   ...
 *
 * Parser 永不阻塞:任意子段缺失 → 对应字段为空,继续。
 */
export function parseEntitiesOwnership(source: string): Omit<EntitiesOwnershipData, "exists" | "last_modified"> {
  const text = source.endsWith("\n") ? source : source + "\n";

  // 切出 "## 完整归属清单" H2 段
  const tableSectionMatch = text.match(
    /(##\s+完整归属清单[^\n]*\n)([\s\S]*?)(?=^##\s+|$(?![\r\n\s\S]))/m
  );

  let preamble: string;
  let tableBody: string;
  let trailing: string;

  if (tableSectionMatch && tableSectionMatch.index !== undefined) {
    preamble = text.slice(0, tableSectionMatch.index).replace(/\s+$/, "");
    tableBody = tableSectionMatch[2];
    const tableEnd = tableSectionMatch.index + tableSectionMatch[0].length;
    trailing = text.slice(tableEnd).trim();
  } else {
    // 容错:没有 "## 完整归属清单" H2,把整个文件当 preamble,无表
    preamble = text.replace(/\s+$/, "");
    tableBody = "";
    trailing = "";
  }

  const rows = parseTableRows(tableBody);
  return { rows, preamble, trailing };
}

/**
 * 解析 markdown 表格,返回有序行流(含分组分隔行)。
 */
function parseTableRows(tableBody: string): OwnershipRow[] {
  const out: OwnershipRow[] = [];
  const lines = tableBody.split("\n");
  let inTable = false;
  let headerSeen = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) {
      // 不在表格内时遇到非表格行 → 重置(用于宽容解析多个表格,虽然 spec 只允许一个)
      inTable = false;
      headerSeen = false;
      continue;
    }
    inTable = true;
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());

    // 跳过分隔线 `|------|------|...`
    if (cells.every((c) => /^[-:]+$/.test(c))) continue;
    // 第一行是表头(实体 / 归属 / 维护权限 / 备注),记下并跳过
    if (!headerSeen) {
      headerSeen = true;
      continue;
    }

    // 分组分隔行:第 1 cell 用 **粗体** 包裹,其余 cell 为空
    const firstCell = cells[0] ?? "";
    const restEmpty = cells.slice(1).every((c) => c.length === 0);
    const boldMatch = firstCell.match(/^\*\*(.+?)\*\*$/);
    if (boldMatch && restEmpty) {
      const groupRow: OwnershipGroupRow = { kind: "group", name: boldMatch[1].trim() };
      out.push(groupRow);
      continue;
    }

    // 数据行
    if (cells.length < 4 || firstCell.length === 0) continue;
    const { name, alias } = splitNameAlias(firstCell);
    const entity: OwnershipEntityRow = {
      kind: "entity",
      name,
      alias,
      layer: cells[1] ?? "",
      maintainers: cells[2] ?? "",
      note: cells[3] ?? ""
    };
    out.push(entity);
  }

  void inTable;
  return out;
}

/**
 * 拆分 `EntityName(中文别名)` → `{ name: 'EntityName', alias: '中文别名' }`
 * 仅当首段是 PascalCase / lowercase ID + 括号中文时拆;否则视全字符串为 name,alias 为空。
 */
function splitNameAlias(raw: string): { name: string; alias: string } {
  // 全/半角括号都接受
  const m = raw.match(/^([A-Za-z][A-Za-z0-9_]*)\s*[((]([^))]+)[))]\s*$/);
  if (m) {
    return { name: m[1].trim(), alias: m[2].trim() };
  }
  return { name: raw.trim(), alias: "" };
}

/**
 * 把解析后的 EntitiesOwnershipData 重新序列化为 markdown(用于写盘)。
 * preamble + `## 完整归属清单` + 表格 + trailing。
 */
export function renderEntitiesOwnership(data: {
  preamble: string;
  rows: OwnershipRow[];
  trailing: string;
}): string {
  const headerLines = [
    "| 实体 | 归属 | 维护权限 | 备注 |",
    "|------|------|----------|------|"
  ];
  const bodyLines = data.rows.map((r) => {
    if (r.kind === "group") {
      return `| **${r.name}** |  |  |  |`;
    }
    const nameCell = r.alias ? `${r.name}(${r.alias})` : r.name;
    return `| ${escapeCell(nameCell)} | ${escapeCell(r.layer)} | ${escapeCell(r.maintainers)} | ${escapeCell(r.note)} |`;
  });
  const tableSection = ["## 完整归属清单", "", ...headerLines, ...bodyLines, ""].join("\n");

  const parts: string[] = [];
  if (data.preamble.trim().length > 0) parts.push(data.preamble.trim(), "");
  else parts.push("# 实体的机构 / 校区归属清单", "");
  parts.push(tableSection);
  if (data.trailing.trim().length > 0) parts.push(data.trailing.trim(), "");
  return parts.join("\n") + "\n";
}

function escapeCell(s: string): string {
  // markdown 表格 cell 内禁止裸 `|`(会被吃成列分隔)和换行(整行结构会乱)。
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * 在 rows 中查找指定 name 的 entity 行索引。找不到返回 -1。
 */
export function findEntityRowIndex(rows: OwnershipRow[], name: string): number {
  return rows.findIndex((r) => r.kind === "entity" && r.name === name);
}
