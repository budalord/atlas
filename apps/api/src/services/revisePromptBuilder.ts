import path from "node:path";
import type { GlobalFeedbackScope, ProductMeta } from "@atlas/shared";
import { DATA_ROOT, readTextFile } from "./fileReader";
import { normalizeProductMeta, parseYaml } from "./markdownParser";
import { loadEntities, loadModules, loadFeatures } from "./entityLoader";
import { parseGlobalFeedbackFile } from "./globalFeedbackParser";

export interface FeaturePromptStats {
  features_with_revision: number;
  global_count: number;
}

export interface EntityPromptStats {
  entities_with_revision: number;
  global_count: number;
}

export interface PrototypePromptStats {
  global_count: number;
}

export type ReviseStats = FeaturePromptStats | EntityPromptStats | PrototypePromptStats;

export interface ReviseResult {
  prompt: string;
  stats: ReviseStats;
}

const atlasRoot = path.resolve(DATA_ROOT, "..");

async function loadMeta(productId: string): Promise<ProductMeta | null> {
  const src = await readTextFile("products", productId, "meta.yml");
  if (!src) return null;
  try {
    return normalizeProductMeta(parseYaml(src));
  } catch {
    return null;
  }
}

function header(productMeta: ProductMeta | null, productId: string, scopeLabel: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const productLine = productMeta ? `${productMeta.name} (${productId})` : productId;
  const workdir = path.join(atlasRoot, "data", "products", productId);
  return [
    `# Atlas ${scopeLabel}修订任务`,
    "",
    "## 上下文",
    `- 产品: ${productLine}`,
    `- 工作目录: ${workdir}/`,
    `- 当前时间: ${today}`,
    ""
  ].join("\n");
}

const FEATURE_TASK = `## 你的任务
你是 Atlas 的功能点修订 Agent。根据下面的反馈,修订对应的 feature md 文件。

工作流要求:
1. 先阅读完所有反馈和上下文,在响应里输出一份 diff plan(打算改什么、不改什么、为什么)
2. **等用户确认后再实际写文件**(用 Edit/Write 工具)
3. 写完每个文件后,在该文件:
   - 把 frontmatter 的 needs_revision 删除(或改为 false)
   - **如果反馈影响了功能点的语义边界 / 关键取舍 / 决策者需要拍的事**,同步更新 \`## 给决策者\` 段(白话 3-5 行;不出现实体名/字段名/锚点);该段缺失则新建在 \`## 描述\` 之前
   - **如果你改了 \`## 给决策者\` 内容,顺便把 frontmatter 的 \`reviewed_at\` / \`reviewed_by\` 字段删掉**(决策者视角变了 = 需要重新审阅)
   - 把 ## 反馈池 段清空为 \`[]\`
   - 在 ## 修订记录 段追加一行: "{today}: 基于 N 条反馈修订 - 简短说明"
     (如果该 feature 没有 ## 修订记录 段,自己新建)
4. 如果某条反馈你不采纳,在 diff plan 里说明理由,但仍要清理该条反馈
   (否则 needs_revision 不会消失,下次 revise 会重复处理)
5. 全局需求池条目处理完后,**直接编辑 GLOBAL-FEEDBACK.md** 清理:
   - 在对应 yaml 块里删除已处理 gfb 条目(整段 \`- id: gfb-xxx ... content: ...\` 都删)
   - 保留未处理 / 暂不采纳的条目
   - 如果某条 gfb 你判断不采纳,在 diff plan 里说明理由,但仍然删除它
     (否则下次 revise 会重复看到)
   - 保留 frontmatter 的 \`last_updated\` 并更新为今天
   - 三段(\`## 功能点需求\` / \`## 实体需求\` / \`## 原型需求\`)结构保持不变,空段写 \`[]\`
`;

const ENTITY_TASK = `## 你的任务
你是 Atlas 的实体修订 Agent。根据下面的反馈,修订对应的 entity md 文件。

工作流要求同 feature 修订(diff plan → 等确认 → 清理 needs_revision + 清空反馈池 + 追加修订记录)。
全局需求池条目处理完后,**直接编辑 GLOBAL-FEEDBACK.md**:
- 在 \`## 实体需求\` 段的 yaml 块里删除已处理 gfb 条目
- 不采纳的也要在 diff plan 说明理由并删除
- 更新 frontmatter \`last_updated\`,三段结构保持(空段写 \`[]\`)
`;

const FEATURE_FOOTER = (productId: string) => `## 注意事项
- 不要触碰 data/products/${productId}/ 之外的文件
- 不要修改 STATUS.md / SUMMARY.md / 补充 .md
- 每个 feature.md 改完后,运行 atlas 应能正常加载(不要破坏 frontmatter 结构)
- 如果反馈让你做"新增 feature"的事,在新位置 data/products/${productId}/modules/{moduleId}/features/{newId}.md 创建文件
  * frontmatter 必须包含 id, name, module, created_at
  * 新文件 needs_revision 不要写(新建即基线,无需修订)
`;

const ENTITY_FOOTER = (productId: string) => `## 注意事项
- 不要触碰 data/products/${productId}/ 之外的文件
- 不要修改 STATUS.md / SUMMARY.md / 补充 .md
- entity.md 的 ## 字段 / ## 关系 / ## 决策 段结构是 parser 依赖的,改完后保持表头与列数一致
- 如果反馈让你做"新增 entity"的事,顶层共享实体放 entities/<id>.md,模块实体放 modules/<m>/entities/<id>.md
`;

/** 拼接一个 feature 的反馈块 */
function featureBlock(
  moduleId: string,
  featureId: string,
  description: string,
  feedbackLines: string[]
): string {
  const desc = description.trim() || "(暂无描述)";
  return [
    `### ${moduleId}/${featureId}`,
    `当前描述:`,
    desc,
    "",
    `反馈条目(${feedbackLines.length} 条):`,
    ...feedbackLines,
    ""
  ].join("\n");
}

function entityBlock(
  scope: string,
  entityId: string,
  feedbackLines: string[]
): string {
  return [
    `### ${scope}/${entityId}`,
    `反馈条目(${feedbackLines.length} 条):`,
    ...feedbackLines,
    ""
  ].join("\n");
}

function globalSection(scope: GlobalFeedbackScope, items: Awaited<ReturnType<typeof parseGlobalFeedbackFile>>[GlobalFeedbackScope]): string {
  const label = scope === "feature" ? "功能点" : scope === "entity" ? "实体" : "原型";
  if (items.length === 0) {
    return `## 全局需求池(scope=${scope})\n(无)\n\n`;
  }
  const lines = items.map((it) => `- [${it.id}] (${it.date}) ${it.content.replace(/\n/g, " ")}`);
  return `## 全局需求池(scope=${scope}) — ${label}\n${lines.join("\n")}\n\n`;
}

export async function buildFeatureRevisePrompt(productId: string): Promise<ReviseResult> {
  const meta = await loadMeta(productId);
  const modules = await loadModules(productId);
  const allFeatureBlocks: string[] = [];
  let featuresWithRevision = 0;

  for (const mod of modules) {
    const features = await loadFeatures(productId, mod.name);
    for (const f of features) {
      const fbs = f.feedback ?? [];
      if (!f.needs_revision && fbs.length === 0) continue;
      featuresWithRevision += 1;
      const fbLines = fbs.length === 0
        ? ["(frontmatter 标了 needs_revision 但反馈池已空,可能是上轮没清理干净,请确认是否仍需修订)"]
        : fbs.map((fb) => `- [${fb.id}] (${fb.date}) ${fb.content.replace(/\n/g, " ")}`);
      allFeatureBlocks.push(featureBlock(mod.name, f.id, f.description, fbLines));
    }
  }

  const global = await parseGlobalFeedbackFile(productId);

  const parts: string[] = [
    header(meta, productId, "功能点"),
    FEATURE_TASK,
    "## 待处理的 feature 反馈",
    "",
    allFeatureBlocks.length === 0 ? "(没有 needs_revision=true 的 feature)\n" : allFeatureBlocks.join("---\n"),
    globalSection("feature", global.feature),
    FEATURE_FOOTER(productId)
  ];

  return {
    prompt: parts.join("\n"),
    stats: {
      features_with_revision: featuresWithRevision,
      global_count: global.feature.length
    }
  };
}

export async function buildEntityRevisePrompt(productId: string): Promise<ReviseResult> {
  const meta = await loadMeta(productId);
  const entities = await loadEntities(productId);
  const blocks: string[] = [];
  let entitiesWithRevision = 0;

  for (const e of entities) {
    const fbs = e.feedback ?? [];
    if (!e.needs_revision && fbs.length === 0) continue;
    entitiesWithRevision += 1;
    const fbLines = fbs.length === 0
      ? ["(frontmatter 标了 needs_revision 但反馈池已空,请确认是否仍需修订)"]
      : fbs.map((fb) => `- [${fb.id}] (${fb.date}) ${fb.content.replace(/\n/g, " ")}`);
    const scope = e.module ? `modules/${e.module}/entities` : "entities";
    blocks.push(entityBlock(scope, e.id, fbLines));
  }

  const global = await parseGlobalFeedbackFile(productId);

  const parts: string[] = [
    header(meta, productId, "实体"),
    ENTITY_TASK,
    "## 待处理的 entity 反馈",
    "",
    blocks.length === 0 ? "(没有 needs_revision=true 的 entity)\n" : blocks.join("---\n"),
    globalSection("entity", global.entity),
    ENTITY_FOOTER(productId)
  ];

  return {
    prompt: parts.join("\n"),
    stats: {
      entities_with_revision: entitiesWithRevision,
      global_count: global.entity.length
    }
  };
}

export async function buildPrototypeRevisePrompt(productId: string): Promise<ReviseResult> {
  const meta = await loadMeta(productId);
  const global = await parseGlobalFeedbackFile(productId);

  const placeholder = [
    header(meta, productId, "原型"),
    "## 占位提示词",
    "原型阶段提示词模板将在后续轮次定义,当前占位。",
    "",
    globalSection("prototype", global.prototype)
  ].join("\n");

  return {
    prompt: placeholder,
    stats: { global_count: global.prototype.length }
  };
}
