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
  | "flowchart"
  | "entity-derive";

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
你是 Atlas 的大 Agent。基于产品描述,生成 Atlas 三层架构的功能点骨架,**严格遵守 feature-source-contract**。

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

## 给决策者                               ← 必填,**决策者视角**(白话 3-5 行)

<面向业务决策方,回答 4 件事:>
- **解决谁的痛**:<一句话>
- **不做的后果**:<一句话>
- **关键取舍**:<一句话,如"X 换 Y">
- **需要拍的事**:<决策者需要拍板的具体问题(可多条);若无写"无">

写作要求:
- 不出现实体名 / 字段名 / v1 §X.X / D-XX 锚点
- 不超过 5 条 bullet,每条 ≤ 30 字
- 写不出来宁可空着也别灌水

## 描述                                   ← 必填,**轻形态**(三个粗体小标题,Agent/工程师视角)

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
你是 Atlas 的实体 Agent。基于产品的全部 **features**,识别出业务**实体**(Entity),
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
你是 Atlas 的规范 Agent。基于现有 **features + entities**,识别出该产品级别的**规范约束**(L0),
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
 * 流程图生成 prompt(**决策者视角 · per-module 切分版**):
 *   - 输入:产品的全部 modules + features(含 roles + 触发后续)+ docs/decision-maker-flowchart-contract.md(全文 inline)
 *   - 输出:Agent 写 N+1 份文件到 data/products/<id>/derived/flowcharts/by-module/:
 *     - <moduleId>.mmd  (每个有 features 的 module 一张图)
 *     - questions.md    (per-module 诊断单聚合在这一份)
 *   - 老 main.mmd / main.questions.md(工程师视角 · entity 派生 Agent 用)**不再由本 prompt 维护**
 *   - prompt 自闭包:把新 contract 全文 inline,Agent 不需要额外读 docs/
 */
export async function buildFlowchartGeneratePrompt(
  productId: string
): Promise<GenerateResult> {
  const meta = await loadMeta(productId);
  const stats = await collectStats(productId);
  const modules = await loadModules(productId);
  const registry = await loadRolesRegistry();

  // 按 module 分组的 feature 快照(对齐 per-module 输出文件结构)
  // 每个 module 单独成块,含其 module_group 列表 + 该 module 下所有 features 的 name/group/触发后续
  const moduleBlocks: string[] = [];
  let totalFeatures = 0;
  for (const mod of modules) {
    const features = await loadFeatures(productId, mod.name);
    if (features.length === 0) continue; // 没 features 的模块不生成 .mmd
    totalFeatures += features.length;

    const groupLines = (mod.groups ?? [])
      .map((g) => `  - ${g.id} → "${g.name}"`)
      .join("\n");

    const featLines = features
      .map((f) => {
        // 从 description 里抽"触发后续"那一行(精确字符串,Agent 据此画 arrows)
        const triggerLineMatch = f.description.match(/\*\*触发后续\*\*\s*[::]\s*([^\n]+)/);
        const trigger = triggerLineMatch ? triggerLineMatch[1].trim() : "(无)";
        const groupId = f.module_group || "(未分组)";
        return `  - **${f.id}** · ${groupId} · "${f.name}"\n    触发后续: ${trigger}`;
      })
      .join("\n");

    moduleBlocks.push(
      `### Module: ${mod.name} · ${mod.title || mod.name}
- 输出文件: \`${`data/products/${productId}/derived/flowcharts/by-module/${mod.name}.mmd`}\`
- 模块 module_group 清单(subgraph 来源):
${groupLines || "  (无 module_group 声明)"}
- 该模块下 features(${features.length}):
${featLines}`
    );
  }

  const rolesList = registry.roles
    .map((r) => `- ${r.name} (id: ${r.id})${r.note ? ` — ${r.note}` : ""}`)
    .join("\n");

  const contractText = await readDecisionMakerFlowchartContractText();

  const outputDir = `data/products/${productId}/derived/flowcharts/`;
  const byModuleDir = `${outputDir}by-module/`;
  const today = new Date().toISOString().slice(0, 10);

  const parts = [
    header(meta, productId, "决策者流程图"),
    `## 你的任务
你是 Atlas 的**决策者流程图**生成 Agent。基于产品的全部 **功能点 + module_group + 触发后续字段** 和下面
inline 的 **decision-maker-flowchart-contract**,产出 per-module 流程图:

1. **每个有 features 的 module 一份 \`.mmd\`** 文件,放在 \`${byModuleDir}<moduleId>.mmd\`
2. **聚合 questions** 一份 \`${byModuleDir}questions.md\`(如果有拿不准的)

**这套图是给业务决策方看的**,不是给工程师 / Agent 看的。所以:
- 节点 = feature(显示 \`feature.name\`),不是 entity.action.scope
- subgraph = module_group(用中文显示名),不是 role swimlane
- arrows 数据源 = feature md 的 \`触发后续\` 字段(精确字符串里的 feature id 引用)
- 跨模块引用 = 用 \`X_xxx\` 虚框节点表示(详见 contract §3.2)

工作流要求:
1. 先输出**生成计划**:
   - 你打算给哪些 module 生成 .mmd?哪些跳过(features=0)?
   - 每个 module 大约几个节点 + 几条 arrows?
   - 跨模块引用的 feature 有哪些?
2. **等用户确认后**再用 Edit/Write 工具实际写文件
3. 严格遵守 contract:**节点身份从 feature md 来,Agent 不增不删**
4. 不要写 \`${byModuleDir}\` 以外的任何文件;不要回写 features/*.md / MODULE.md
5. **不再生成 main.mmd / main.questions.md**(那是老工程师视角 contract 的产物,与本 prompt 无关)
6. 每个 .mmd 文件头必须有:
   \`\`\`
   %% Module: <moduleId> · <module 中文显示名>
   %% 视角: 决策者 — 展示该模块下功能点的业务触发关系
   %% 来源: data/products/${productId}/modules/<moduleId>/(features/ 的 触发后续 字段)
   %% 生成时间: <ISO timestamp>
   \`\`\`
   ⚠ **不要写单独一行的 \`%%\`(只有两个百分号没内容)** —— mermaid 10.x 解析器会炸,报错
   \`Parse error on line 1: %%flowchart LR  su\`。注释段之间要分隔就用空行或 \`%% ---\` / \`%% Notes:\`
   等带内容的形式。
7. questions.md 是 YAML 列表;每条带 \`module\`(哪个模块)、\`trigger.feature_path\` + \`trigger.original_text\`

## ⚠ 抛 question 前必读

**用户视角:用户做业务规则决定,不做 schema/工程决定**。

抛 question 前必过 5 级自检:
1. feature.md description / 字段清单 / 触发后续 中有答案? → 有,自决
2. DECISIONS.md / SEAMS.md / ENTITIES-OWNERSHIP.md 中有答案? → 有,自决
3. 能用 grep / ls / 模式匹配判断? → 能,自己查,自决
4. 业务问题(用户能拍板) 还是 工程问题(用户答不了)?
   - 工程问题(用什么数据结构 / 命名 / 布局方向 LR vs TD) → 自决,可在 mmd 头部 \`%% Note: ...\` 留 trail
   - 业务问题(谁、什么时候、按什么业务规则) → 去第 5 级
5. 你能写出 proposed_resolution? → 能写出 = 已自决 = **直接执行,不抛**

**判别金句**:不写代码光开会能说清楚的是业务问题(可抛),必须看 schema 才能定的是工程问题(自决)。

**反例 — 这些都属于"已自决但翻译成了 question",不许抛**:
- ❌ "用 LR 还是 TD 布局?"(自决,优先 TD,>10 节点改 LR)
- ❌ "feature X 该挂在哪个 group 下?"(看 feature.module_group 字段)
- ❌ "跨模块虚框该不该画?"(看"触发后续"是否引用别模块的 feature)

**正例 — 真业务问题**:
- ✅ "feature A 的"触发后续"写了 feature_B,但 feature_B 在 features/ 目录下找不到。是写错了还是漏建了?"
- ✅ "feature A 和 B 都列了"触发 C",但 C 在两个模块都不存在,我画不出 arrow,要不要建 C?"
`,
    "",
    "## 当前已知信息",
    describeProduct(meta, productId),
    "",
    `### 全局角色注册表 (data/roles.yml · 仅供参考,本 prompt 不用作 swimlane)
${rolesList}`,
    "",
    `### 全部模块 + 功能点(共 ${moduleBlocks.length} 个模块 / ${totalFeatures} 个 features)`,
    moduleBlocks.length === 0
      ? "(无 features — 该产品尚未建模块/功能点树,无法生成流程图。请先跑 generate-feature。)"
      : moduleBlocks.join("\n\n"),
    "",
    "---",
    "",
    "## 必读 · decision-maker-flowchart-contract 全文 (inline)",
    "",
    contractText,
    "",
    "---",
    "",
    `## 输出约定速查
- 文件位置: ${byModuleDir}<moduleId>.mmd (每模块一份) + ${byModuleDir}questions.md (聚合)
- 节点格式: \`F_<feature_id>["<feature.name>"]\` (同模块) / \`X_<feature_id>(["⇨ <feature.name><br/><small>来自 <module 显示名></small>"])\` (跨模块)
- subgraph: \`subgraph G_<group_id>["<group 中文显示名>"]\`
- arrows: 同模块 \`-->\` / 跨模块 \`-.->\`
- arrows 数据源: feature md 的 **触发后续** 字段(每条只能引用已存在的 feature id)
- 当前时间(用作文件头): ${today}T00:00:00Z
`,
    "",
    FOOTER(
      productId,
      "- 流程图是给决策者看的,不是给 Agent 看的(Agent 派生实体走老 main.mmd 链路,不在本 prompt 范围)\n- 任何不确定走 questions.md,不要凭'业务常识'编 feature 关系\n- 不要写 main.mmd / main.questions.md(那是另一个 prompt 的事)"
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

let dmContractCache: { mtime: number; text: string } | null = null;

async function readDecisionMakerFlowchartContractText(): Promise<string> {
  const contractPath = path.resolve(
    DATA_ROOT,
    "..",
    "docs",
    "decision-maker-flowchart-contract.md"
  );
  try {
    const stat = await fs.stat(contractPath);
    const mtime = stat.mtimeMs;
    if (dmContractCache && dmContractCache.mtime === mtime) return dmContractCache.text;
    const text = await fs.readFile(contractPath, "utf8");
    dmContractCache = { mtime, text };
    return text;
  } catch {
    return "(警告:docs/decision-maker-flowchart-contract.md 缺失,Agent 必须先要求用户提供该文件)";
  }
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

/**
 * Path C 实体派生提示词。
 * 见 docs/entity-contract.md。
 *
 * 输入信号(全部 source layer):
 *   - features × N(modules/<m>/features/<f>.md 的 frontmatter + 字段清单 + 状态转移 + 字段权限)
 *   - SEAMS.md(跨模块字段映射)
 *   - DECISIONS.md(决策号引用)
 *   - ENTITIES-OWNERSHIP.md(ground truth 归属表)
 *
 * 输出(写入 data/products/<id>/derived/entities/):
 *   - 每实体一个 <Name>.md
 *   - questions.md(诊断单,trigger 模式与 flowchart-contract §6.3 一致)
 *   - reconcile-report.md(派生 vs 声明的差异)
 */
export async function buildEntityDerivePrompt(productId: string): Promise<GenerateResult> {
  const meta = await loadMeta(productId);
  const stats = await collectStats(productId);
  const modules = await loadModules(productId);
  const registry = await loadRolesRegistry();

  // 收集 features(含 entities_touched / ownership / 字段清单 / 状态转移)
  const featureBlocks: string[] = [];
  for (const mod of modules) {
    const features = await loadFeatures(productId, mod.name);
    for (const f of features) {
      const featurePath = `data/products/${productId}/modules/${mod.name}/features/${f.id}.md`;
      const desc = f.description.trim() || "(无描述)";
      const rolesLine = f.roles && f.roles.length > 0
        ? f.roles
            .map((id) => {
              const role = registry.roles.find((r) => r.id === id);
              return role ? `${role.name}(id: ${id})` : `${id} ⚠未在 RolesRegistry`;
            })
            .join(", ")
        : "(未指定)";
      const fieldsLine = f.fields && f.fields.length > 0
        ? f.fields.map((row) => `  | ${row.name} | ${row.type} | ${row.required ? "✓" : "-"} | ${row.constraint} | ${row.note} |`).join("\n")
        : "  (无 ## 字段清单 段)";
      const statesLine = f.state_transitions && f.state_transitions.length > 0
        ? f.state_transitions.map((row) => `  | ${row.from} | ${row.to} | ${row.trigger} | ${row.role} |`).join("\n")
        : "  (无 ## 状态转移 段)";
      featureBlocks.push(
        `### [${mod.name}/${f.id}] ${f.name}
- **feature_path**: ${featurePath}
- **roles**: ${rolesLine}
- **entities_touched**: ${(f.entities_touched ?? []).join(", ") || "(未指定)"}
- **ownership**: ${f.ownership ?? "(未指定)"}
- **description**:
${indent(desc, "  ")}
- **字段清单**:
${fieldsLine}
- **状态转移**:
${statesLine}`
      );
    }
  }

  const seamsText = (await readTextFile("products", productId, "SEAMS.md")) ?? "(无 SEAMS.md)";
  const decisionsText = (await readTextFile("products", productId, "DECISIONS.md")) ?? "(无 DECISIONS.md)";
  const ownershipText = (await readTextFile("products", productId, "ENTITIES-OWNERSHIP.md")) ?? "(无 ENTITIES-OWNERSHIP.md)";
  // 流程图 main.mmd 含已经规范化的 Entity 名,实体派生 Agent 必须与其严格一致。
  // 文件不存在 → 没有流程图作锚点,派生 Agent 自己挑名字,但要在派生计划中说明。
  const flowchartMmdText = (await readTextFile("products", productId, "derived", "flowcharts", "main.mmd")) ?? "(无 main.mmd — 该产品流程图尚未生成,实体命名请按 flowchart-contract §3.4 / §3.4.2 自行规范并在派生计划中说明映射表)";

  const rolesList = registry.roles
    .map((r) => `- ${r.name} (id: ${r.id})${r.note ? ` — ${r.note}` : ""}`)
    .join("\n");

  const contractText = await readEntityContractText();
  const flowchartContractText = await readFlowchartContractText();

  const outputDir = `data/products/${productId}/derived/entities/`;
  const today = new Date().toISOString();

  const parts = [
    header(meta, productId, "Path C 实体派生"),
    `## 你的任务
你是 Atlas 的 Path C **实体派生 Agent**。基于产品的 4 类 source 输入(features × N / SEAMS / DECISIONS /
ENTITIES-OWNERSHIP),产出 derived 实体清单 + reconcile 报告 + questions。

输出文件(全部写到 \`${outputDir}\`):
1. \`<EntityName>.md\` — 每实体一个文件(见下方契约 §3)
2. \`questions.md\` — 诊断单(对偶 flowchart §6.3,trigger lint 同模式)
3. \`reconcile-report.md\` — 派生 vs 声明的差异(见契约 §4)

工作流要求:
1. 先输出**派生计划**:
   - 列你打算派生的所有实体 + 它们的命名映射表(见 flowchart-contract §3.4 / §3.4.1 / §3.4.2)
   - 列你打算抛多少 question?对应哪些 source?
   - 列预期 reconcile 差异:派生有声明无 N1 / 声明有派生无 N2 / 归属不一致 N3
2. **等用户确认后**再用 Edit/Write 工具实际写文件
3. 严格遵守契约。**派生只读 — 不要回写 features/SEAMS/DECISIONS/ENTITIES-OWNERSHIP**
4. 缺数据 → 标 \`[TBD]\` + 写 questions.md ticket;**不要"业务常识"补**
5. 命名规范以 flowchart-contract §3.4 / §3.4.1 / §3.4.2 为准 — 优先与 derived/flowcharts/main.mmd 中的 Entity 名一致(若该文件存在)
6. 每个 entity md 必须含 frontmatter \`name / layer / maintainers / sourceFeatures[] / generated_at\`(其余字段可选)
7. 当前生成时间(写入 generated_at): ${today}

## ⚠ 抛 question 前必读(同 flowchart-contract §6.3.5)

**用户做业务规则决定,不做 schema/工程决定**。

抛 question 前必过 5 级自检:
1. feature.md / SEAMS / DECISIONS / ENTITIES-OWNERSHIP 中有答案? → 有,自决
2. derived/flowcharts/main.mmd 中有答案? → 有,自决(优先以流程图为命名锚点)
3. 能用 grep / ls / 模式匹配判断? → 能,自己查,自决
4. 业务问题 vs 工程问题?
   - 工程(字段 vs 表 / 类型 / 命名 / 关系建模) → 自决,可在 entity md 加 \`<!-- Agent note: ... -->\` 留 trail
   - 业务(谁有权 / 何时触发 / 业务约束) → 去第 5 级
5. 能写出 proposed_resolution? → 能写出 = 已自决 = **直接执行,不抛**

**判别金句**:不写代码光开会能说清楚的是业务问题,必须看 schema 才能定的是工程问题。

**反例**(本轮派生 Agent 不许抛):
- ❌ "X 字段是 string 还是 enum?"(看 feature 字段清单 / 自决)
- ❌ "X 是 FK 还是嵌入?"(关系建模 / 自决)
- ❌ "状态机要不要加 X 状态?"(看 feature 状态转移段 / 自决)
- ❌ "X 是否应该有索引?"(纯工程)

**正例**:
- ✅ "推荐人改名后,推荐关系字段保持 id 还是写历史 name?"(业务规则)
- ✅ "SEAMS §5.6 三边契约里财务先动还是教务先动?"(业务流程)
- ✅ "Entitlement 撤销时,关联的 AttendanceRecord 是删还是留作历史?"(业务约束)
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
      ? "(无 — 该产品尚未建模块/功能点树,无法派生实体。请先跑 generate-feature。)"
      : featureBlocks.join("\n\n"),
    "",
    "### SEAMS.md(跨模块接缝契约)",
    seamsText,
    "",
    "### DECISIONS.md(决策日志)",
    decisionsText,
    "",
    "### ENTITIES-OWNERSHIP.md(实体归属 ground truth)",
    ownershipText,
    "",
    "### derived/flowcharts/main.mmd(已生成的流程图 — 实体命名锚点)",
    "派生实体的 name 必须与本文件中出现的 Entity 名严格一致(同 entity 不可起新名,不同 entity 不可合并)。",
    "```mermaid",
    flowchartMmdText,
    "```",
    "",
    "---",
    "",
    "## 必读 · entity-contract 全文 (inline)",
    "",
    contractText,
    "",
    "---",
    "",
    "## 必读 · flowchart-contract §3.4 / §3.4.1 / §3.4.2(实体命名规范)",
    "",
    flowchartContractText,
    "",
    "---",
    "",
    `## 输出约定速查
- 派生目录: ${outputDir}
- 每实体一文件: <EntityName>.md(PascalCase 文件名,与 frontmatter.name 一致)
- 诊断单: ${outputDir}questions.md(YAML 数组)
- reconcile 报告: ${outputDir}reconcile-report.md(三段 H2 + 表格)
- 当前时间(用作 frontmatter.generated_at): ${today}
`,
    "",
    FOOTER(
      productId,
      "- 派生只读,**不要回写** features/SEAMS/DECISIONS/ENTITIES-OWNERSHIP\n- 缺数据宁可标 [TBD] + 走 questions.md,不要凭'业务常识'补\n- 命名规范优先匹配 derived/flowcharts/main.mmd 中已有的 Entity 名"
    )
  ];

  return { prompt: parts.join("\n"), stats };
}

let entityContractCache: { mtime: number; text: string } | null = null;
async function readEntityContractText(): Promise<string> {
  const contractPath = path.resolve(DATA_ROOT, "..", "docs", "entity-contract.md");
  try {
    const stat = await fs.stat(contractPath);
    const mtime = stat.mtimeMs;
    if (entityContractCache && entityContractCache.mtime === mtime) return entityContractCache.text;
    const text = await fs.readFile(contractPath, "utf8");
    entityContractCache = { mtime, text };
    return text;
  } catch {
    return "(警告:docs/entity-contract.md 缺失,Agent 必须先要求用户提供该文件)";
  }
}

let flowchartContractCache: { mtime: number; text: string } | null = null;
async function readFlowchartContractText(): Promise<string> {
  const contractPath = path.resolve(DATA_ROOT, "..", "docs", "flowchart-contract.md");
  try {
    const stat = await fs.stat(contractPath);
    const mtime = stat.mtimeMs;
    if (flowchartContractCache && flowchartContractCache.mtime === mtime) return flowchartContractCache.text;
    const text = await fs.readFile(contractPath, "utf8");
    // 仅提取 §3.4 / §3.4.1 / §3.4.2(精简体积)
    const m = text.match(/### 3\.4 实体命名一致性[\s\S]*?(?=^##\s+|$(?![\s\S]))/m);
    const slice = m ? m[0] : text;
    flowchartContractCache = { mtime, text: slice };
    return slice;
  } catch {
    return "(警告:docs/flowchart-contract.md 缺失)";
  }
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
