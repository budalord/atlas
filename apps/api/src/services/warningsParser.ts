import type {
  ArchitecturalWarning,
  ArchitecturalWarningsData,
  WarningStatus
} from "@atlas/shared";

const VALID_STATUS = new Set<WarningStatus>(["待承接", "部分承接", "已纳入"]);

/**
 * 解析 ARCHITECTURAL-WARNINGS.md。
 *
 * 形态(docs/warnings-contract.md):
 *   # 学长三个架构性警告的承接
 *   (preamble)
 *
 *   ## 警告 1 · 产品版本化 [已纳入]
 *
 *   **学长原话**:
 *   > 备注:"历史订单价格"与"产品当前价格"解耦,...
 *
 *   **学长原意**:价格调整时...
 *
 *   **整体规格承接**:
 *   - A 产品线核心要求...
 *
 *   **含义**:从 v1 开始...
 *
 *   ---
 *
 *   ## 警告 2 · ...
 *
 * H2 头格式: `## 警告 N · <title> [<status>]`
 *   - status 可选,默认 "待承接"
 *   - 合法 status: 待承接 / 部分承接 / 已纳入
 *
 * 4 个粗体小标题(均可选):学长原话 / 学长原意 / 整体规格承接 / 含义
 */
export function parseWarningsMarkdown(
  source: string
): Pick<ArchitecturalWarningsData, "warnings" | "preamble"> {
  const text = source.endsWith("\n") ? source : source + "\n";

  // 切出 preamble(第一个 `## 警告` 之前)
  const firstH2Idx = text.search(/^##\s+警告\s+\S/m);
  const preamble = firstH2Idx === -1 ? text.replace(/\s+$/, "") : text.slice(0, firstH2Idx).replace(/\s+$/, "");

  // 匹配每个 H2 块
  const blockRegex = /^##\s+警告\s+(\S+?)\s*·\s*([^\n\[]+?)(?:\s*\[([^\]]+)\])?\s*\n([\s\S]*?)(?=^##\s+警告\s+|$(?![\r\n\s\S]))/gm;
  const out: ArchitecturalWarning[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(text)) !== null) {
    const id = m[1].trim();
    const title = m[2].trim();
    const statusRaw = m[3]?.trim();
    let status: WarningStatus = "待承接";
    if (statusRaw && VALID_STATUS.has(statusRaw as WarningStatus)) {
      status = statusRaw as WarningStatus;
    }
    const body = m[4].trim();
    out.push({
      id,
      title,
      status,
      originalQuote: extractBoldField(body, "学长原话") || extractBoldField(body, "原话"),
      interpretation: extractBoldField(body, "学长原意") || extractBoldField(body, "原意"),
      resolution: extractBoldField(body, "整体规格承接") || extractBoldField(body, "承接"),
      implication: extractBoldField(body, "含义"),
      body
    });
  }

  // 按 id 数字升序(若 id 非数字则按字母序)
  out.sort((a, b) => {
    const na = parseInt(a.id, 10);
    const nb = parseInt(b.id, 10);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.id.localeCompare(b.id);
  });
  return { warnings: out, preamble };
}

/**
 * 提取 **<label>**: 后面的内容,跨行,直到下个 **xxx**: 或下个 `---` 或下个 `##` 或文末。
 */
function extractBoldField(body: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `\\*\\*${escaped}\\*\\*\\s*[::]\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*[^*\\n]+\\*\\*\\s*[::]|\\n---\\s*\\n|\\n##\\s+|$(?![\\r\\n\\s\\S]))`,
    "m"
  );
  const m = body.match(re);
  return m ? m[1].trim() : "";
}

/**
 * 重序列化为 markdown(POST/PATCH 用)。
 */
export function renderWarningsMarkdown(data: {
  preamble: string;
  warnings: ArchitecturalWarning[];
}): string {
  const parts: string[] = [];
  if (data.preamble.trim().length > 0) parts.push(data.preamble.trim(), "");
  else parts.push("# 架构警告", "");

  for (const w of data.warnings) {
    const statusSuffix = ` [${w.status}]`;
    parts.push(`## 警告 ${w.id} · ${w.title}${statusSuffix}`, "");
    if (w.originalQuote) parts.push(`**学长原话**: ${w.originalQuote}`, "");
    if (w.interpretation) parts.push(`**学长原意**: ${w.interpretation}`, "");
    if (w.resolution) parts.push(`**整体规格承接**: ${w.resolution}`, "");
    if (w.implication) parts.push(`**含义**: ${w.implication}`, "");
    parts.push("---", "");
  }
  return parts.join("\n") + "\n";
}

/**
 * 计算下一个警告 id(数字 + 1,若现有 id 非数字则用字母序后续)。
 */
export function nextWarningId(warnings: ArchitecturalWarning[]): string {
  let maxNum = 0;
  for (const w of warnings) {
    const n = parseInt(w.id, 10);
    if (!Number.isNaN(n) && n > maxNum) maxNum = n;
  }
  return String(maxNum + 1);
}
