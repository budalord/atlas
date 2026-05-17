import YAML from "yaml";
import type { Feedback } from "@atlas/shared";

/**
 * 从 markdown 正文中提取 `## 反馈池` 段下的第一个 yaml 代码块,解析为 Feedback[]。
 *
 * 约定格式(批次 1' 精简后,整个 ## 反馈池 段):
 *   ## 反馈池
 *
 *   ```yaml
 *   - id: fb-20260515-a1b2c3
 *     date: 2026-05-15
 *     content: |
 *       建议把 X 改成 Y...
 *   ```
 *
 * 容错策略:
 *   - 段不存在 → 返回 []
 *   - 段存在但无 yaml 代码块 → 返回 []
 *   - yaml 解析失败 → 返回 [](不抛错,UI 显示空)
 *   - yaml 顶层不是数组 → 返回 []
 *   - 旧格式字段(type/status/source/decision_note/acceptance_scope/decided_at)直接忽略,
 *     条目仍可读出 id/date/content 三字段
 *   - 三字段中任一为空 → 该条目过滤掉,其余保留
 */
export function parseFeedbackSection(body: string): Feedback[] {
  const section = extractFeedbackSection(body);
  if (!section) return [];
  const yamlText = extractFirstYamlBlock(section);
  if (yamlText === null) return [];
  let parsed: unknown;
  try {
    parsed = YAML.parse(yamlText);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: Feedback[] = [];
  for (const raw of parsed) {
    const fb = normalizeFeedback(raw);
    if (fb) out.push(fb);
  }
  return out;
}

/**
 * 给定一段反馈数组,序列化回 `## 反馈池` 段的 markdown 文本(含 yaml 代码块)。
 * 空数组写成 ```yaml\n[]\n```。供 feedbackWriter 用。
 * 输出只含 id/date/content 三字段,不写任何旧格式字段。
 */
export function serializeFeedbackSection(feedback: Feedback[]): string {
  const clean = feedback.map((f) => ({ id: f.id, date: f.date, content: f.content }));
  const yamlBody = clean.length === 0 ? "[]" : YAML.stringify(clean).trimEnd();
  return `## 反馈池\n\n\`\`\`yaml\n${yamlBody}\n\`\`\`\n`;
}

/**
 * 抽取 `## 反馈池` 段的正文(不含段头)。
 * 段终止于下一个同级或更高级标题(## 或 #),或文件末尾。
 */
function extractFeedbackSection(body: string): string | null {
  const re = /^##\s+反馈池\s*$/m;
  const match = body.match(re);
  if (!match || match.index === undefined) return null;
  const headingEnd = body.indexOf("\n", match.index);
  if (headingEnd < 0) return "";
  const rest = body.slice(headingEnd + 1);
  const nextMatch = rest.match(/\n(##?\s+)/);
  return nextMatch && nextMatch.index !== undefined
    ? rest.slice(0, nextMatch.index)
    : rest;
}

/**
 * 在一段文本中找第一个 ```yaml ... ``` 围栏代码块,返回内部内容(不含围栏)。
 * 找不到返回 null。
 */
function extractFirstYamlBlock(section: string): string | null {
  const re = /```ya?ml\s*\n([\s\S]*?)```/;
  const match = section.match(re);
  return match ? match[1].replace(/\s+$/, "") : null;
}

function normalizeFeedback(raw: unknown): Feedback | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  const date = typeof r.date === "string" ? r.date.trim() : "";
  const content = typeof r.content === "string" ? r.content : "";

  if (!id || !date) return null;

  return { id, date, content };
}

/**
 * 解析 `## 修订记录` 段。每条 log 是一个顶层 `- ` 列表项,文本原样保留。
 * 段不存在 → 返回空数组。Atlas 只读不写,Agent revise 时自己 append。
 */
export function parseRevisionLog(body: string): string[] {
  const re = /^##\s+修订记录\s*$/m;
  const match = body.match(re);
  if (!match || match.index === undefined) return [];
  const headingEnd = body.indexOf("\n", match.index);
  if (headingEnd < 0) return [];
  const rest = body.slice(headingEnd + 1);
  const nextMatch = rest.match(/\n(##?\s+)/);
  const section =
    nextMatch && nextMatch.index !== undefined ? rest.slice(0, nextMatch.index) : rest;
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
}
