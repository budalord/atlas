import path from "node:path";
import { promises as fs } from "node:fs";
import type { ProductMeta } from "@atlas/shared";
import { DATA_ROOT, dataPath, readTextFile } from "./fileReader";
import { normalizeProductMeta, parseYaml } from "./markdownParser";
import { loadEntities, loadModules, loadFeatures } from "./entityLoader";
import { loadRolesRegistry } from "./rolesRegistry";

export interface FeatureGenerateStats {
  has_description: boolean;
  features_count: number;
  entities_count: number;
  conventions_exists: boolean;
}

export type GenerateScope =
  | "feature"
  | "entity"
  | "conventions"
  | "prototype"
  | "flowchart";

export interface GenerateResult {
  prompt: string;
  stats: FeatureGenerateStats;
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

async function fileExists(...segments: string[]): Promise<boolean> {
  try {
    await fs.access(dataPath(...segments));
    return true;
  } catch {
    return false;
  }
}

async function collectStats(productId: string): Promise<FeatureGenerateStats> {
  const meta = await loadMeta(productId);
  const modules = await loadModules(productId);
  let featuresCount = 0;
  for (const mod of modules) {
    const features = await loadFeatures(productId, mod.name);
    featuresCount += features.length;
  }
  const entities = await loadEntities(productId);
  const conventions_exists = await fileExists("products", productId, "CONVENTIONS.md");
  return {
    has_description: Boolean(meta?.description?.trim() || meta?.tagline?.trim()),
    features_count: featuresCount,
    entities_count: entities.length,
    conventions_exists
  };
}

function header(productMeta: ProductMeta | null, productId: string, stage: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const productLine = productMeta ? `${productMeta.name} (${productId})` : productId;
  const workdir = path.join(atlasRoot, "data", "products", productId);
  return [
    `# Atlas ${stage}生成任务`,
    "",
    "## 上下文",
    `- 产品: ${productLine}`,
    `- 工作目录: ${workdir}/`,
    `- 当前时间: ${today}`,
    `- 阶段: ${stage}(从零生成)`,
    ""
  ].join("\n");
}

const FOOTER = (productId: string, extra?: string) => `## 注意事项
- 这是**从零生成**任务,不是修订任务;请先看清当前已有内容再决定要不要覆盖
- 不要触碰 data/products/${productId}/ 之外的文件
- 文件 frontmatter 必须保留 Atlas 解析约定(id / name / module / created_at 等)
- features 文件路径: modules/<moduleId>/features/<featureId>.md
- entities 文件路径(顶层共享): entities/<entityId>.md
- entities 文件路径(模块下): modules/<moduleId>/entities/<entityId>.md
- 新建文件不要加 needs_revision 标签(新建即基线,无需修订)
- 不要污染 STATUS.md / SUMMARY.md / 补充 .md
${extra ?? ""}`;

function describeProduct(meta: ProductMeta | null, productId: string): string {
  if (!meta) return `产品 ${productId}(meta.yml 未找到)`;
  const lines = [
    `- 名称: ${meta.name}`,
    `- 主题: ${meta.theme}`,
    `- 当前状态: ${meta.status}`,
    `- 技术栈: ${meta.tech_stack.join(", ") || "(未填)"}`
  ];
  if (meta.tagline) lines.push(`- 标语: ${meta.tagline}`);
  if (meta.description) lines.push(`- 描述: ${meta.description}`);
  return lines.join("\n");
}

export async function buildFeatureGeneratePrompt(productId: string): Promise<GenerateResult> {
  const meta = await loadMeta(productId);
  const stats = await collectStats(productId);

  const warning =
    stats.features_count > 0
      ? `> ⚠ 注意: 该产品已存在 **${stats.features_count}** 个 feature。你的生成会与现有结构并存,**请避免命名冲突**;如要替换,先在生成计划里说明。\n\n`
      : "";

  const parts = [
    header(meta, productId, "功能点"),
    `## 你的任务
你是开发者的大 Agent。基于产品描述,生成 Atlas 三层架构的功能点骨架,**严格遵守 feature-source-contract**。

**三层架构**:
1. **业务方向 (module)** — 顶层划分,如 销售线 / 财务线 / 教务线
2. **管理模块 (module_group)** — 中层,每条业务方向下的几个管理域,如 学员管理 / 订单管理 / 推荐管理
3. **功能点 (feature)** — 叶子,具体动作或功能

**三种约束承载并存** (per docs/feature-source-contract.md):
- **轻**:\`## 描述\` 段写作规范(三个粗体小标题)
- **中**:frontmatter 结构化字段 \`entities_touched\` / \`ownership\`
- **重**:三个可选专门段 \`## 字段清单\` / \`## 状态转移\` / \`## 字段权限\`

工作流要求:
1. 先输出**生成计划**:
   - 划几个业务方向 (module),每个 module 下几个 管理模块 (group)
   - 每个 group 下挂哪些 feature
   - 哪些 feature 是简单 feature(只填轻+中)、哪些复杂(还要填重形态)
   - 文件路径预览
2. **等用户确认后再实际写文件**(用 Edit/Write 工具)
3. 严格遵守"输出约定"
4. 新建文件不加 needs_revision 标签
`,
    warning,
    "## 当前已知信息",
    describeProduct(meta, productId),
    "",
    `## 输出约定

### MODULE.md(必建,含三层架构中层声明)

\`\`\`yaml
---
id: sales
name: B 销售线
order: 2
groups:
  - id: student-management
    name: 学员管理
    order: 1
  - id: order-management
    name: 订单管理
    order: 2
---

# B 销售线

## 职责
负责学员从初次接触到报名转化的全流程管理。
\`\`\`

### feature.md frontmatter — 必填 + 强建议 + 中形态

\`\`\`yaml
---
# 必填
id: student-intake
name: 学员录入
module: sales
created_at: ${new Date().toISOString().slice(0, 10)}

# 三层架构中层(强建议)
module_group: student-management

# 角色(强建议),id 来自 data/roles.yml
roles:
  - sales
  - partner

# 中形态(强建议):为派生 Agent 提供种子
entities_touched: [User, Order]              # PascalCase 实体规范名
ownership: org                               # org / campus / follows:<Entity> / shared
---
\`\`\`

### feature.md 段结构

\`\`\`markdown
# <name>

## 描述                                   ← 必填,**轻形态**(三个粗体小标题)

<自由叙述,但建议含>

**关键字段**: <字段1 (约束)、字段2 (约束)...>
**关键约束**: <跨实体不变式 / 唯一性 / 权限边界...>
**触发后续**: <调用的下游 feature / 触发的事件...>

## 字段清单                               ← **重形态**,可选(主体实体有 3+ 字段时写)

| 字段 | 类型 | 必填 | 约束 | 备注 |
| --- | --- | --- | --- | --- |
| <name> | <type> | <✓/-> | <unique/FK→Entity/enum/...> | <text> |

## 状态转移                               ← **重形态**,可选(有状态机时写)

| from | to | 触发 | 角色 |
| --- | --- | --- | --- |
| <state> | <state> | <动作描述> | <roleId> |

## 字段权限                               ← **重形态**,可选(字段级权限差异显著时写)

| 字段 | <role1> | <role2> | ... |
| --- | --- | --- | --- |
| <field> | RW | R | - |

## 线索池
### Pending
### Resolved

## 反馈池

\`\`\`yaml
[]
\`\`\`
\`\`\`

### 重形态判断准则

- 简单 feature (纯入口、纯聚合视图) — 三段全部省略
- 半复杂 feature (单一实体有几个字段) — 填 \`## 字段清单\`,其余省略
- 复杂 feature (有状态机或字段级权限差异) — 三段全写

### 写作规范要点

- entities_touched 用规范名,与 flowchart 实体命名一致 (per docs/flowchart-contract.md §3.4)
- 不确定的实体不写,**留给 description 提示;不要为补全而瞎写**
- 字段清单的 类型 / 必填 / 约束 信息用 description 推不出来的 → 标 [TBD]
- 重形态段的表格列数必须严格匹配模板(否则 parser 跳过整段)
`,
    "",
    FOOTER(productId)
  ];

  return { prompt: parts.join("\n"), stats };
}

export async function buildEntityGeneratePrompt(productId: string): Promise<GenerateResult> {
  const meta = await loadMeta(productId);
  const stats = await collectStats(productId);
  const modules = await loadModules(productId);

  const featureLines: string[] = [];
  for (const mod of modules) {
    const features = await loadFeatures(productId, mod.name);
    for (const f of features) {
      const desc = f.description.trim().replace(/\s+/g, " ").slice(0, 120);
      featureLines.push(`- [${mod.name}/${f.id}] ${f.name}${desc ? ` — ${desc}` : ""}`);
    }
  }

  const warning =
    stats.entities_count > 0
      ? `> ⚠ 注意: 该产品已存在 **${stats.entities_count}** 个 entity。你的生成会与现有结构并存,**请避免命名冲突**;如要替换,先在生成计划里说明。\n\n`
      : "";

  const parts = [
    header(meta, productId, "实体"),
    `## 你的任务
你是开发者的实体 Agent。基于产品的全部 **features**,识别出业务**实体**(Entity),
为每个实体生成 entity md 文件。

工作流要求:
1. 先输出**生成计划**:打算识别哪些实体、放在顶层(共享)还是放在某 module 下、关键字段与关系
2. **等用户确认后再实际写文件**
3. 每个 entity.md 必须含 \`## 字段\` 表格(5 列: 字段名 / 类型 / 必填 / 约束 / 备注)、
   \`## 关系\` 列表、\`## 决策\` 列表;末尾加空 \`## 反馈池\` 段(yaml 块 [])
4. 不确定的字段在备注列写 \`[TBD]\`,parser 会识别为 TBD
`,
    warning,
    "## 当前已知信息",
    describeProduct(meta, productId),
    "",
    `### 现有 features(${featureLines.length} 个)`,
    featureLines.length === 0 ? "(无)" : featureLines.join("\n"),
    "",
    `## 输出约定
- 跨模块共享实体放: entities/<entityId>.md
- 模块内独占实体放: modules/<moduleId>/entities/<entityId>.md
- 推荐 frontmatter(立项阶段):
  \`\`\`yaml
  ---
  added_in_phase: planning
  added_at: ${new Date().toISOString().slice(0, 10)}
  ---
  \`\`\`
- 字段表表头与分隔行示例:
  \`\`\`
  | 字段名 | 类型 | 必填 | 约束 | 备注 |
  | --- | --- | --- | --- | --- |
  \`\`\`
- 关系示例: \`- N:1 → Class (class)\` 或 \`- N:1 → Parent (parent) [TBD]\`
- 决策示例: \`- **D-01 决策标题**: 决策理由\`
`,
    "",
    FOOTER(productId)
  ];

  return { prompt: parts.join("\n"), stats };
}

export async function buildConventionsGeneratePrompt(productId: string): Promise<GenerateResult> {
  const meta = await loadMeta(productId);
  const stats = await collectStats(productId);
  const modules = await loadModules(productId);
  const entities = await loadEntities(productId);

  const featureLines: string[] = [];
  for (const mod of modules) {
    const features = await loadFeatures(productId, mod.name);
    for (const f of features) {
      featureLines.push(`- [${mod.name}/${f.id}] ${f.name}`);
    }
  }
  const entityLines = entities.map((e) => {
    const where = e.module ? `modules/${e.module}/entities` : "entities";
    return `- [${where}/${e.id}] ${e.name} (${e.fields.length} 字段, ${e.relations.length} 关系, ${e.decisions.length} 决策)`;
  });

  const warning = stats.conventions_exists
    ? `> ⚠ 注意: 该产品已存在 CONVENTIONS.md。请**增量更新**而非整体覆盖;先读现有内容,只补全或修订必要部分。\n\n`
    : "";

  const parts = [
    header(meta, productId, "L0 规范"),
    `## 你的任务
你是开发者的规范 Agent。基于现有 **features + entities**,识别出该产品级别的**规范约束**(L0),
生成 \`CONVENTIONS.md\`。L0 是 Agent 在 L1(实体)/ L2(功能点)操作时必须遵循的硬约束基线。

工作流要求:
1. 先输出**生成计划**:打算从哪些 features/entities 中归纳哪几条规范
2. **等用户确认后再实际写文件**
3. 输出文件: \`data/products/${productId}/CONVENTIONS.md\`
4. frontmatter 写 \`spec_level: 0\` 和 \`version: 1\`(或递增)+ \`last_updated\`
5. 不要把无法落到约束的"经验性建议"写进 L0;L0 只装"硬约束"
`,
    warning,
    "## 当前已知信息",
    describeProduct(meta, productId),
    "",
    `### 现有 features(${featureLines.length} 个)`,
    featureLines.length === 0 ? "(无)" : featureLines.join("\n"),
    "",
    `### 现有 entities(${entityLines.length} 个)`,
    entityLines.length === 0 ? "(无)" : entityLines.join("\n"),
    "",
    `## 输出约定 — CONVENTIONS.md 结构
建议六段:
1. \`## 命名约定\` — 字段命名、id 命名、枚举命名规则
2. \`## 字段约定\` — 通用字段(created_at / status / soft_delete)的类型与语义
3. \`## 通用流程\` — 产品反复出现的流程片段(签到、回款、版本化)
4. \`## 一致性要求\` — 跨实体的不变式(同 product_id 锁版本号、订单生成时锁定 service_version_id)
5. \`## 禁忌\` — 明确不允许的设计(物理删除、明文存密码、跨校区共享 schedule)
6. \`## 决策快照\` — 影响全局的关键决策(机构层归属、双侧维护、套餐定义)的索引

每段下推荐用编号列表或 \`### 子标题\` 组织。
`,
    "",
    FOOTER(productId)
  ];

  return { prompt: parts.join("\n"), stats };
}

/**
 * 流程图生成 prompt:
 *   - 输入:产品的全部 modules + features(含 roles)+ data/roles.yml + docs/flowchart-contract.md(全文 inline)
 *   - 输出:Agent 写两份文件到 data/products/<id>/derived/flowcharts/:
 *     - main.mmd        (Mermaid swimlane flowchart,节点身份图,下游派生消费)
 *     - main.questions.md(诊断单,给人看,见 contract §6.3)
 *   - prompt 自闭包:把 contract 全文 inline,Agent 不需要去额外读 docs/
 */
export async function buildFlowchartGeneratePrompt(
  productId: string
): Promise<GenerateResult> {
  const meta = await loadMeta(productId);
  const stats = await collectStats(productId);
  const modules = await loadModules(productId);
  const registry = await loadRolesRegistry();

  // 收集所有 feature 的完整快照(roles + description + 路径),作为 prompt 上下文
  const featureBlocks: string[] = [];
  for (const mod of modules) {
    const features = await loadFeatures(productId, mod.name);
    for (const f of features) {
      const featurePath = `data/products/${productId}/modules/${mod.name}/features/${f.id}.md`;
      const rolesLine =
        f.roles && f.roles.length > 0
          ? f.roles
              .map((id) => {
                const role = registry.roles.find((r) => r.id === id);
                return role ? `${role.name}(id: ${id})` : `${id} ⚠未在 RolesRegistry`;
              })
              .join(", ")
          : "(未指定)";
      const desc = f.description.trim() || "(无描述)";
      featureBlocks.push(
        `### [${mod.name}/${f.id}] ${f.name}
- **feature_path**: ${featurePath}
- **roles**: ${rolesLine}
- **description**:
${indent(desc, "  ")}`
      );
    }
  }

  const rolesList = registry.roles
    .map((r) => `- ${r.name} (id: ${r.id})${r.note ? ` — ${r.note}` : ""}`)
    .join("\n");

  // 读 contract 全文 inline(每次重读,文件不大,避免缓存与 contract 编辑脱节)
  const contractText = await readContractText();

  const outputDir = `data/products/${productId}/derived/flowcharts/`;
  const today = new Date().toISOString().slice(0, 10);

  const parts = [
    header(meta, productId, "流程图"),
    `## 你的任务
你是 Atlas 的流程图生成 Agent。基于产品的全部 **功能点 + roles** 和下面 inline 的
**flowchart contract**,产出两份 derived 文件:

1. \`${outputDir}main.mmd\` — Mermaid swimlane flowchart(每个角色一个 subgraph)
2. \`${outputDir}main.questions.md\` — 诊断单(见 contract §6.3)

工作流要求:
1. 先输出**生成计划**:
   - 你打算建多少个节点?哪些是合并/拆分边界 case?
   - 你打算抛多少 question?对应哪些 feature?
   - 选择 §4.2 的方案 A 还是 B 来放置跨多角色节点
2. **等用户确认后**再用 Edit/Write 工具实际写文件
3. 严格遵守 contract。**节点身份零自由度,流程拓扑有限自由度**
4. 不要写 \`${outputDir}\` 以外的任何文件;不要回写 features/*.md
5. main.mmd 文件头必须有(见 contract §4.3):
   \`\`\`
   %% Generated from data/products/${productId}/modules/  · DO NOT EDIT HERE
   %% Source of truth lives in feature points (功能点 tab).
   %% Generated at: <ISO timestamp>
   \`\`\`
6. main.questions.md 是 YAML 列表;每条带 \`trigger.feature_path\` + \`trigger.original_text\`,
   且 \`original_text\` 必须是对应 feature.md 中**已存在的字面子串**(见 contract §6.3.4 的 grep lint)
`,
    "",
    "## 当前已知信息",
    describeProduct(meta, productId),
    "",
    `### 全局角色注册表 (data/roles.yml)
${rolesList}`,
    "",
    `### 全部功能点(${featureBlocks.length} 个)`,
    featureBlocks.length === 0
      ? "(无 — 该产品尚未建模块/功能点树,无法生成流程图。请先跑 generate-feature。)"
      : featureBlocks.join("\n\n"),
    "",
    "---",
    "",
    "## 必读 · flowchart contract 全文 (inline,等同 docs/flowchart-contract.md)",
    "",
    contractText,
    "",
    "---",
    "",
    `## 输出约定速查
- 主图: ${outputDir}main.mmd
- 诊断单: ${outputDir}main.questions.md
- 当前时间(用作文件头): ${today}T00:00:00Z(可改为生成时刻的真实 ISO)
- 节点命名格式: \`[Entity].[action].[scope] <<roles: 中文角色名, ...>>\` (§2.1)
- roles 列表用中文 name(不是 id),逗号 + 空格分隔(§2.2)
- 多角色合并节点用 §4.2 方案 A 或 B,在生成计划里说明你选哪个
`,
    "",
    FOOTER(
      productId,
      "- 流程图与诊断单是 derived,不允许修改 source(features/*.md / MODULE.md / STATUS.md)\n- 任何不确定走 contract §6.3.3 的 questions.md,不要凭'业务常识'补节点"
    )
  ];

  return { prompt: parts.join("\n"), stats };
}

let contractCache: { mtime: number; text: string } | null = null;

async function readContractText(): Promise<string> {
  const contractPath = path.resolve(DATA_ROOT, "..", "docs", "flowchart-contract.md");
  try {
    const stat = await fs.stat(contractPath);
    const mtime = stat.mtimeMs;
    if (contractCache && contractCache.mtime === mtime) return contractCache.text;
    const text = await fs.readFile(contractPath, "utf8");
    contractCache = { mtime, text };
    return text;
  } catch {
    return "(警告:docs/flowchart-contract.md 缺失,Agent 必须先要求用户提供该文件)";
  }
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

export async function buildPrototypeGeneratePrompt(productId: string): Promise<GenerateResult> {
  const meta = await loadMeta(productId);
  const stats = await collectStats(productId);
  const placeholder = [
    header(meta, productId, "原型"),
    "## 占位提示词",
    "原型生成 prompt 模板将在后续轮次定义,当前占位。",
    "",
    "## 当前已知信息",
    describeProduct(meta, productId)
  ].join("\n");
  return { prompt: placeholder, stats };
}
