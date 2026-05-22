import type { Decision, DecisionStatus } from "@atlas/shared";

const VALID_STATUS = new Set<DecisionStatus>(["active", "superseded", "archived"]);

/**
 * 解析 DECISIONS.md。
 *
 * 主形态(docs/decisions-contract.md §2):
 *   ```
 *   ### D-47 · 2026-05-15 · 网课平台抽象 [active]
 *
 *   **决策摘要**: v1 中期以凡科为主,schema 不写死
 *   **影响 features**: video-watch-fanke, course-import
 *   **来源段**: SPEC-V1.md §7.3
 *   **说明**: <自由叙述>
 *   ```
 *
 * 兼容形态(yunkai-erp v1 快照,§12.1 / §12.2 表格):
 *   ```
 *   | 序号 | 决策 | 理由 |
 *   |------|------|------|
 *   | D-23 | 全面自研 ERP | 郝伟锁定的整体路线 |
 *   ```
 *   表格行解析为 minimal Decision(id + summary + body),date/status/sourceRef/affectedFeatures 为空。
 *
 * 永不阻塞 — 解析失败/格式坏 → 跳过该项,继续。
 */
export function parseDecisionsMarkdown(source: string): Decision[] {
  const decisions: Decision[] = [];

  // 主形态:H3 块
  parseH3Blocks(source).forEach((d) => decisions.push(d));

  // 兼容形态:表格行(只解析未被 H3 块覆盖的 id,避免重复)
  const seenIds = new Set(decisions.map((d) => d.id));
  parseTableRows(source).forEach((d) => {
    if (!seenIds.has(d.id)) {
      decisions.push(d);
      seenIds.add(d.id);
    }
  });

  // 按 D-id 数字升序排
  decisions.sort((a, b) => {
    const na = parseDecisionNumber(a.id);
    const nb = parseDecisionNumber(b.id);
    return na - nb;
  });
  return decisions;
}

function parseH3Blocks(source: string): Decision[] {
  // 末尾补换行,让最后一块也能 lookahead 到 `^##` 边界 (或文末)
  const text = source.endsWith("\n") ? source : source + "\n";
  // 匹配以 `### D-NN ...` 开头,到下个 `### D-NN` 或 `## ` 行 或 文末为止
  // 使用 lazy `[\s\S]*?` + 多边界 lookahead
  const blockRegex = /^###\s+(D-\d+)\b([^\n]*)\n([\s\S]*?)(?=^###\s+D-\d+|^##\s+|$(?![\r\n\s\S]))/gm;
  const out: Decision[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(text)) !== null) {
    const id = m[1];
    const headerRest = m[2].trim();
    const body = m[3].trim();
    out.push(parseH3Block(id, headerRest, body));
  }
  return out;
}

/**
 * 解析单个 H3 块头 + 内容。
 *
 * header 形如: ` · 2026-05-15 · 网课平台抽象 [active]`
 * 用 ` · ` 分隔。最后可选 `[status]`。
 */
function parseH3Block(id: string, header: string, body: string): Decision {
  let date = "";
  let title = "";
  let status: DecisionStatus = "active";

  // 提取 [status]
  const statusMatch = header.match(/\[([a-z]+)\]\s*$/);
  let headerStripped = header;
  if (statusMatch) {
    const raw = statusMatch[1] as DecisionStatus;
    if (VALID_STATUS.has(raw)) status = raw;
    headerStripped = header.slice(0, statusMatch.index).trim();
  }
  // 按 ` · ` 切片
  const parts = headerStripped
    .split(/\s*·\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // parts[0] 可能是日期(YYYY-MM-DD)或标题
  if (parts.length > 0) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
      date = parts[0];
      title = parts.slice(1).join(" · ");
    } else {
      title = parts.join(" · ");
    }
  }

  return {
    id,
    date,
    title,
    status,
    summary: extractBoldField(body, "决策摘要"),
    affectedFeatures: parseCommaList(extractBoldField(body, "影响 features")),
    sourceRef: extractBoldField(body, "来源段"),
    body
  };
}

/**
 * 解析 markdown 表格中以 `| D-NN |` 开头的行,落为 minimal Decision。
 * 容忍表格列数 3 ~ 4(yunkai 模板 3 列;扩展模板可能 4 列含日期)。
 */
function parseTableRows(source: string): Decision[] {
  const out: Decision[] = [];
  const lines = source.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    // 必须满足 `| D-NN | ... |` 形态(D-NN 在第 1 cell,不能在第 2 cell 防止误吸表头)
    const cells = trimmed.slice(1, -1).split("|").map((c) => c.trim());
    if (cells.length < 2) continue;
    const idCell = cells[0].replace(/\*\*/g, "").trim();
    if (!/^D-\d+$/.test(idCell)) continue;

    const summary = (cells[1] ?? "").trim();
    const rest = cells.slice(2).join(" | ").trim(); // 余下列拼成 body 备注

    out.push({
      id: idCell,
      date: "",
      title: summary, // 表格形态没有独立 title,复用 summary
      status: "active",
      summary,
      affectedFeatures: [],
      sourceRef: "",
      body: rest.length > 0 ? `**理由**: ${rest}` : ""
    });
  }
  return out;
}

function extractBoldField(body: string, label: string): string {
  // 匹配 `**<label>**: <value>`,值到行尾(或下个 `**xxx**:` 起的位置)
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\*\\*${escaped}\\*\\*\\s*[::]\\s*([^\\n]+)`);
  const m = body.match(re);
  return m ? m[1].trim() : "";
}

function parseCommaList(value: string): string[] {
  if (!value) return [];
  return value
    .split(/[,,、]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseDecisionNumber(id: string): number {
  const m = id.match(/^D-(\d+)$/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/**
 * 给定决策清单,计算下一个 D-N 编号。空清单 → "D-1"。
 */
export function nextDecisionId(existing: Decision[]): string {
  let maxNum = 0;
  for (const d of existing) {
    const n = parseDecisionNumber(d.id);
    if (n !== Number.MAX_SAFE_INTEGER && n > maxNum) maxNum = n;
  }
  return `D-${maxNum + 1}`;
}

/**
 * 构造一个 H3 块的 markdown,用于追加到 DECISIONS.md 末尾。
 */
export function renderDecisionBlock(d: Decision): string {
  const headerParts: string[] = [d.id];
  if (d.date) headerParts.push(d.date);
  if (d.title) headerParts.push(d.title);
  let header = headerParts.join(" · ");
  if (d.status && d.status !== "active") header += ` [${d.status}]`;
  else header += " [active]";

  const lines: string[] = [`### ${header}`, ""];
  if (d.summary) lines.push(`**决策摘要**: ${d.summary}`);
  if (d.affectedFeatures.length > 0) {
    lines.push(`**影响 features**: ${d.affectedFeatures.join(", ")}`);
  }
  if (d.sourceRef) lines.push(`**来源段**: ${d.sourceRef}`);
  if (d.body) {
    // 已含详细 body 时,把 body 作为 `**说明**:` 段
    const stripped = d.body.trim();
    if (stripped && !stripped.startsWith("**说明**")) {
      lines.push(`**说明**: ${stripped}`);
    } else {
      lines.push(stripped);
    }
  }
  return lines.join("\n");
}
