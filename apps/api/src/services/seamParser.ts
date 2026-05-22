import type { Seam } from "@atlas/shared";

/**
 * 解析 SEAMS.md(单文件 H2 章节)。
 *
 * 形态(per docs/seams-contract.md;yunkai-erp v1 快照即此):
 *
 *   ## 5.1 A → B(产品定义被销售调用)
 *
 *   - **调用方**: B 销售线
 *   - **被调用方**: A 产品线
 *   - **触发时机**: 销售打开学员录入页面
 *
 *   **数据契约**:
 *   - <字段映射 / typescript-like 代码块>
 *
 *   **异常处理**:
 *   - <场景> → <处理>
 *
 *   ---
 *
 * 解析器宽容:
 * - H2 行 id 可以是 "5.1" / "A→B" / "A → B" / 等任意前缀
 * - 子字段缺失 → 该字段为空字符串
 * - body 段总是保留(供 UI 完整展开渲染)
 */
export function parseSeamsMarkdown(source: string): Seam[] {
  const text = source.endsWith("\n") ? source : source + "\n";
  // 匹配 ## 标题行,id 形如 "5.1" 或 "A→B"(字母 + 箭头 + 字母)
  // 行内允许任意后缀,正文到下个 H2 或 文末
  const blockRegex = /^##\s+([0-9]+(?:\.[0-9]+)?|[A-Z]\s*[→⟷⟶<>]+\s*[A-Z])\s*([^\n]*)\n([\s\S]*?)(?=^##\s+|$(?![\r\n\s\S]))/gm;
  const out: Seam[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(text)) !== null) {
    const id = m[1].trim();
    const titleRest = m[2].trim();
    const body = m[3].trim();
    out.push(parseSeamBlock(id, titleRest, body));
  }
  return out;
}

function parseSeamBlock(id: string, titleRest: string, body: string): Seam {
  return {
    id,
    title: titleRest,
    caller: extractBulletField(body, "调用方"),
    callee: extractBulletField(body, "被调用方"),
    trigger: extractBulletField(body, "触发时机"),
    dataContract: extractFollowingBlock(body, "数据契约"),
    exceptions: extractFollowingBlock(body, "异常处理"),
    body
  };
}

/** 提取 `- **<label>**: <value>` 形态的单行字段值 */
function extractBulletField(body: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 允许 `- **<label>**: ...` 或 `**<label>**: ...`
  const re = new RegExp(`(?:^-\\s+)?\\*\\*${escaped}\\*\\*\\s*[::]\\s*([^\\n]+)`, "m");
  const m = body.match(re);
  return m ? m[1].trim() : "";
}

/**
 * 提取 `**<label>**:` 之后的内容,直到下个 `**xxx**:` 或下个 `---` / `##` 或文末。
 * 适用 "数据契约 / 异常处理" 这种多行块。
 */
function extractFollowingBlock(body: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 跨行匹配 `**<label>**:\n<内容>\n` 直到 `\n**xxx**:` 或 `\n---` 或 `\n##` 或文末
  const re = new RegExp(
    `\\*\\*${escaped}\\*\\*\\s*[::]\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*[^*\\n]+\\*\\*\\s*[::]|\\n---\\s*\\n|\\n##\\s+|$(?![\\r\\n\\s\\S]))`,
    "m"
  );
  const m = body.match(re);
  return m ? m[1].trim() : "";
}
