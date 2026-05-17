import YAML from "yaml";
import { promises as fs } from "node:fs";
import type {
  GlobalFeedback,
  GlobalFeedbackData,
  GlobalFeedbackScope
} from "@atlas/shared";
import { dataPath } from "./fileReader";

/**
 * 全局需求池文件路径:data/products/<id>/GLOBAL-FEEDBACK.md
 */
export function globalFeedbackPath(productId: string): string {
  return dataPath("products", productId, "GLOBAL-FEEDBACK.md");
}

const SECTION_HEADINGS: Record<GlobalFeedbackScope, string> = {
  feature: "## 功能点需求",
  entity: "## 实体需求",
  prototype: "## 原型需求"
};

/**
 * 加载并解析 GLOBAL-FEEDBACK.md。文件不存在返回三段空数组。
 * 三段独立解析,任一段 yaml 损坏不影响其他段。
 */
export async function parseGlobalFeedbackFile(
  productId: string
): Promise<GlobalFeedbackData> {
  let source: string;
  try {
    source = await fs.readFile(globalFeedbackPath(productId), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { feature: [], entity: [], prototype: [] };
    }
    throw err;
  }

  const body = stripFrontmatter(source);
  return {
    feature: parseSection(body, "feature"),
    entity: parseSection(body, "entity"),
    prototype: parseSection(body, "prototype")
  };
}

function stripFrontmatter(source: string): string {
  const match = source.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return match ? match[1] : source;
}

function parseSection(body: string, scope: GlobalFeedbackScope): GlobalFeedback[] {
  const heading = SECTION_HEADINGS[scope];
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}\\s*$`, "m");
  const match = body.match(re);
  if (!match || match.index === undefined) return [];

  const start = match.index + match[0].length;
  const rest = body.slice(start);
  const nextHeading = rest.match(/\n##?\s+/);
  const section =
    nextHeading && nextHeading.index !== undefined
      ? rest.slice(0, nextHeading.index)
      : rest;

  const yamlMatch = section.match(/```ya?ml\s*\n([\s\S]*?)```/);
  if (!yamlMatch) return [];

  let parsed: unknown;
  try {
    parsed = YAML.parse(yamlMatch[1]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: GlobalFeedback[] = [];
  for (const raw of parsed) {
    const fb = normalizeEntry(raw, scope);
    if (fb) out.push(fb);
  }
  return out;
}

function normalizeEntry(raw: unknown, defaultScope: GlobalFeedbackScope): GlobalFeedback | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  const date = typeof r.date === "string" ? r.date.trim() : "";
  const content = typeof r.content === "string" ? r.content : "";
  if (!id || !date) return null;
  // scope 字段如果存在且合法则用,否则用 section 推断的 defaultScope
  let scope: GlobalFeedbackScope = defaultScope;
  if (typeof r.scope === "string") {
    const s = r.scope.trim();
    if (s === "feature" || s === "entity" || s === "prototype") scope = s;
  }
  return { id, date, content, scope };
}

/**
 * 把三段数据序列化回完整的 markdown 文本(含 frontmatter)。
 * 空段写成 ```yaml\n[]\n```。
 */
export function serializeGlobalFeedbackFile(
  data: GlobalFeedbackData,
  lastUpdated: string
): string {
  const head = `---\nlast_updated: ${lastUpdated}\n---\n\n# 全局需求池\n\n`;
  return (
    head +
    sectionText("feature", data.feature) +
    sectionText("entity", data.entity) +
    sectionText("prototype", data.prototype)
  );
}

function sectionText(scope: GlobalFeedbackScope, items: GlobalFeedback[]): string {
  const clean = items.map((f) => ({
    id: f.id,
    date: f.date,
    scope: f.scope,
    content: f.content
  }));
  const yamlBody = clean.length === 0 ? "[]" : YAML.stringify(clean).trimEnd();
  return `${SECTION_HEADINGS[scope]}\n\n\`\`\`yaml\n${yamlBody}\n\`\`\`\n\n`;
}
