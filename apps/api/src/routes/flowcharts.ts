import { Router, Request } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FlowchartData, FlowchartQuestion } from "@atlas/shared";
import { DATA_ROOT, dataPath, listMarkdownFiles, listDirectories } from "../services/fileReader";
import { getDataVersion } from "../services/watcher";
import { parseYaml } from "../services/markdownParser";

export const flowchartsRouter = Router({ mergeParams: true });

const REPO_ROOT = path.resolve(DATA_ROOT, "..");

/**
 * GET /api/products/:id/flowchart
 *
 * 读 data/products/{id}/derived/flowcharts/main.mmd + 同目录 main.questions.md。
 * 同时:
 *   - 跑 stale 判定(features/*.md / roles.yml 的最大 mtime > main.mmd mtime → stale)
 *   - 跑 trigger lint(每条 question.trigger.original_text 必须在 feature_path 文件中 grep -F 命中)
 */
flowchartsRouter.get("/", async (req: Request<{ id: string }>, res, next) => {
  try {
    const productId = req.params.id;
    const mmdPath = dataPath(
      "products",
      productId,
      "derived",
      "flowcharts",
      "main.mmd"
    );
    const questionsPath = dataPath(
      "products",
      productId,
      "derived",
      "flowcharts",
      "main.questions.md"
    );

    const mmdContent = await readFileOrNull(mmdPath);
    const questionsContent = await readFileOrNull(questionsPath);

    const exists = mmdContent !== null;
    const mmdMtime = await safeMtime(mmdPath);
    const generated_at = exists
      ? extractHeaderTimestamp(mmdContent!) ?? mmdMtime
      : null;

    const { stale, stale_reason } = await computeStale(productId, mmdMtime);

    const { questions, errors } = parseQuestions(questionsContent);
    const lintErrors = await lintTriggers(questions);
    const allErrors = [...errors, ...lintErrors];

    const data: FlowchartData = {
      mermaid: mmdContent,
      generated_at,
      exists,
      stale,
      stale_reason,
      questions,
      questions_lint_ok: allErrors.length === 0,
      questions_lint_errors: allErrors
    };
    res.json({ data, version: getDataVersion() });
  } catch (e) {
    next(e);
  }
});

async function readFileOrNull(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function safeMtime(absPath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(absPath);
    return stat.mtime.toISOString();
  } catch {
    return null;
  }
}

/** 解析 main.mmd 头部 "%% Generated at: <iso>" 注释行;找不到返回 null。 */
function extractHeaderTimestamp(content: string): string | null {
  const head = content.split("\n").slice(0, 5).join("\n");
  const match = head.match(/%%\s*Generated\s+at:\s*([^\s]+)/i);
  return match ? match[1].trim() : null;
}

/**
 * Stale 判定:遍历产品下所有 features/*.md + data/roles.yml,任一 mtime > main.mmd mtime → stale。
 * main.mmd 不存在 → stale=false(空状态由 UI 自己引导,不和 stale 叠加显示)。
 */
async function computeStale(
  productId: string,
  mmdMtime: string | null
): Promise<{ stale: boolean; stale_reason: string | null }> {
  if (!mmdMtime) return { stale: false, stale_reason: null };
  const mmdMs = Date.parse(mmdMtime);

  // 收集所有 feature.md 路径 + roles.yml
  const candidates: Array<{ label: string; absPath: string }> = [];
  const modulesRoot = dataPath("products", productId, "modules");
  try {
    const moduleDirs = await listDirectories("products", productId, "modules");
    for (const mod of moduleDirs) {
      try {
        const files = await listMarkdownFiles(
          "products",
          productId,
          "modules",
          mod,
          "features"
        );
        for (const f of files) {
          candidates.push({
            label: `${mod}/${f.replace(/\.md$/, "")}`,
            absPath: path.join(modulesRoot, mod, "features", f)
          });
        }
      } catch {
        // 模块下没有 features 目录 — 跳过
      }
    }
  } catch {
    // 该产品没有 modules 目录 — 没有可对照的 feature mtime
  }
  candidates.push({ label: "roles.yml", absPath: dataPath("roles.yml") });

  let newest: { label: string; mtime: number } | null = null;
  for (const c of candidates) {
    const m = await getFileMtimeMs(c.absPath);
    if (m === null) continue;
    if (!newest || m > newest.mtime) newest = { label: c.label, mtime: m };
  }
  if (!newest) return { stale: false, stale_reason: null };
  if (newest.mtime <= mmdMs) return { stale: false, stale_reason: null };

  const newestIso = new Date(newest.mtime).toISOString();
  return {
    stale: true,
    stale_reason: `${newest.label} 在 ${newestIso} 修改晚于流程图(${mmdMtime})`
  };
}

async function getFileMtimeMs(absPath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(absPath);
    return stat.mtime.getTime();
  } catch {
    return null;
  }
}

/**
 * 解析 main.questions.md。允许内容是裸 YAML 数组,或 markdown 中包了 ```yaml ... ``` 围栏。
 * 解析失败返回空数组 + 错误条目;字段缺失的 question 也归入 errors。
 */
function parseQuestions(content: string | null): {
  questions: FlowchartQuestion[];
  errors: string[];
} {
  if (content === null) return { questions: [], errors: [] };
  const yamlText = extractYamlBlock(content);
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (e) {
    return {
      questions: [],
      errors: [
        `main.questions.md 不是合法 YAML: ${e instanceof Error ? e.message : String(e)}`
      ]
    };
  }
  if (raw === null || raw === undefined) return { questions: [], errors: [] };
  if (!Array.isArray(raw)) {
    return {
      questions: [],
      errors: ["main.questions.md 顶层必须是数组(YAML list)"]
    };
  }

  const questions: FlowchartQuestion[] = [];
  const errors: string[] = [];
  raw.forEach((item, idx) => {
    const out = normalizeQuestion(item, idx);
    if ("question" in out) questions.push(out);
    else errors.push(out.error);
  });
  return { questions, errors };
}

/** 从 markdown 中抽 ```yaml ... ``` 围栏;没有围栏则返回全文。 */
function extractYamlBlock(content: string): string {
  const fence = content.match(/```ya?ml\n([\s\S]*?)\n```/);
  if (fence) return fence[1];
  return content;
}

function normalizeQuestion(
  item: unknown,
  idx: number
): FlowchartQuestion | { error: string } {
  if (!item || typeof item !== "object") {
    return { error: `第 ${idx + 1} 项不是对象` };
  }
  const it = item as Record<string, unknown>;
  const feature = typeof it.feature === "string" ? it.feature : "";
  const mod = typeof it.module === "string" ? it.module : "";
  const question = typeof it.question === "string" ? it.question : "";
  const trigger = it.trigger as
    | { feature_path?: unknown; original_text?: unknown }
    | undefined;
  const fp = trigger && typeof trigger.feature_path === "string" ? trigger.feature_path : "";
  const ot = trigger && typeof trigger.original_text === "string" ? trigger.original_text : "";
  const proposedRaw =
    typeof it.proposed_resolution === "string"
      ? it.proposed_resolution
      : typeof (it as { ["proposed-resolution"]?: unknown })["proposed-resolution"] === "string"
        ? ((it as { ["proposed-resolution"]: string })["proposed-resolution"])
        : undefined;

  if (!feature || !mod || !question || !fp || !ot) {
    return {
      error: `第 ${idx + 1} 项缺字段(需要 feature / module / question / trigger.feature_path / trigger.original_text)`
    };
  }
  const out: FlowchartQuestion = {
    feature,
    module: mod,
    question,
    trigger: { feature_path: fp, original_text: ot }
  };
  if (proposedRaw !== undefined) out.proposed_resolution = proposedRaw;
  return out;
}

/**
 * Trigger lint(contract §6.3.4):
 * 对每条 question.trigger,读 feature_path 文件,判断 original_text 是否是字面子串。
 * 不读 STATUS.md / SUMMARY.md / MODULE.md 等非 feature.md 文件 — trigger 必须 root 在某个 feature。
 */
async function lintTriggers(questions: FlowchartQuestion[]): Promise<string[]> {
  const errors: string[] = [];
  for (const q of questions) {
    const fp = q.trigger.feature_path;
    if (!fp.startsWith("data/products/") || !/\/features\/[^/]+\.md$/.test(fp)) {
      errors.push(
        `feature: ${q.feature} — trigger.feature_path 必须形如 data/products/<id>/modules/<m>/features/<f>.md,实际: ${fp}`
      );
      continue;
    }
    const abs = path.resolve(REPO_ROOT, fp);
    const content = await readFileOrNull(abs);
    if (content === null) {
      errors.push(`feature: ${q.feature} — trigger.feature_path 文件不存在: ${fp}`);
      continue;
    }
    if (!content.includes(q.trigger.original_text)) {
      const preview =
        q.trigger.original_text.length > 60
          ? q.trigger.original_text.slice(0, 60) + "..."
          : q.trigger.original_text;
      errors.push(
        `feature: ${q.feature} — trigger.original_text 在 ${fp} 中 grep 不到("${preview}")`
      );
    }
  }
  return errors;
}
