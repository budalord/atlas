import { promises as fs } from "node:fs";
import YAML from "yaml";
import type { Feedback, GlobalFeedbackScope } from "@atlas/shared";
import { loadModules, loadFeatures, loadEntities } from "./entityLoader";
import { loadUseCases } from "./usecaseLoader";
import { loadScreens } from "./screenLoader";
import { dataPath } from "./fileReader";

/**
 * v0.2c §5.3: 统一反馈池查询, 替代各 revisePromptBuilder 内联聚合逻辑。
 * 给 /api/agent/feedback 端点用 + builder 后续可复用。
 */

export type FeedbackScope = "feature" | "entity" | "usecase" | "screen";

export interface PendingFeedbackItem {
  scope: FeedbackScope;
  /** 对象 id (feature/usecase/screen id 或 entity name) */
  targetId: string;
  /** 模块 (entity 顶层共享时为 null) */
  module: string | null;
  feedback: Feedback;
}

export interface PendingGlobalFeedbackItem {
  scope: GlobalFeedbackScope;
  id: string;
  date: string;
  content: string;
}

/**
 * 列出对象级反馈池里 pending 的所有条目。
 * scope 未指定 = 全部 scope。
 */
export async function listPendingFeedback(
  productId: string,
  scope?: FeedbackScope
): Promise<PendingFeedbackItem[]> {
  const out: PendingFeedbackItem[] = [];
  const scopes = scope ? [scope] : (["feature", "entity", "usecase", "screen"] as FeedbackScope[]);

  if (scopes.includes("feature")) {
    const modules = await loadModules(productId);
    for (const mod of modules) {
      const features = await loadFeatures(productId, mod.name);
      for (const f of features) {
        for (const fb of f.feedback ?? []) {
          out.push({ scope: "feature", targetId: f.id, module: f.module, feedback: fb });
        }
      }
    }
  }
  if (scopes.includes("entity")) {
    const entities = await loadEntities(productId);
    for (const e of entities) {
      for (const fb of e.feedback ?? []) {
        out.push({ scope: "entity", targetId: e.id, module: e.module, feedback: fb });
      }
    }
  }
  if (scopes.includes("usecase")) {
    const ucs = await loadUseCases(productId);
    for (const u of ucs) {
      for (const fb of u.feedback ?? []) {
        out.push({ scope: "usecase", targetId: u.id, module: u.module, feedback: fb });
      }
    }
  }
  if (scopes.includes("screen")) {
    const screens = await loadScreens(productId);
    for (const s of screens) {
      for (const fb of s.feedback ?? []) {
        out.push({ scope: "screen", targetId: s.id, module: s.module, feedback: fb });
      }
    }
  }
  return out;
}

/**
 * 列出 GLOBAL-FEEDBACK.md 三段 (feature / entity / prototype) 的所有未处理条目。
 */
export async function listGlobalFeedback(
  productId: string,
  scope?: GlobalFeedbackScope
): Promise<PendingGlobalFeedbackItem[]> {
  const gfPath = dataPath("products", productId, "GLOBAL-FEEDBACK.md");
  let source: string;
  try {
    source = await fs.readFile(gfPath, "utf8");
  } catch {
    return [];
  }
  const out: PendingGlobalFeedbackItem[] = [];
  const sectionScopes: GlobalFeedbackScope[] = scope ? [scope] : ["feature", "entity", "prototype"];
  const headings: Record<GlobalFeedbackScope, string> = {
    feature: "## 功能点需求",
    entity: "## 实体需求",
    prototype: "## 原型需求"
  };
  for (const s of sectionScopes) {
    const section = extractYamlBlockUnderHeading(source, headings[s]);
    if (!section) continue;
    try {
      const parsed = YAML.parse(section) as Array<{ id?: string; date?: string; content?: string }> | null;
      if (!Array.isArray(parsed)) continue;
      for (const e of parsed) {
        if (typeof e?.id === "string" && typeof e?.date === "string" && typeof e?.content === "string") {
          out.push({ scope: s, id: e.id, date: e.date, content: e.content });
        }
      }
    } catch {
      // 单段 yaml 损坏不影响其他段
    }
  }
  return out;
}

/** 在 markdown 里找指定 `## 标题` 下紧跟的 ```yaml 块, 返回 yaml 文本; 找不到 null. */
function extractYamlBlockUnderHeading(source: string, heading: string): string | null {
  const lines = source.split("\n");
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === heading) {
      // 找下一个 ```yaml ... ```
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j < lines.length && /^```\s*yaml\s*$/i.test(lines[j].trim())) {
        const start = j + 1;
        let end = start;
        while (end < lines.length && lines[end].trim() !== "```") end++;
        return lines.slice(start, end).join("\n");
      }
      return null;
    }
    i++;
  }
  return null;
}

