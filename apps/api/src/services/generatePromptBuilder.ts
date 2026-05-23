import path from "node:path";
import { promises as fs } from "node:fs";
import type { ProductMeta } from "@atlas/shared";
import { DATA_ROOT, dataPath, readTextFile } from "./fileReader";
import { normalizeProductMeta, parseYaml } from "./markdownParser";
import { loadEntities, loadModules, loadFeatures } from "./entityLoader";
import { loadRolesRegistry } from "./rolesRegistry";
import { parseGlobalFeedbackFile } from "./globalFeedbackParser";
import { loadActors } from "./actorLoader";
import { loadCapabilities, attachCapabilityRefs } from "./capabilityLoader";
import { loadUseCases } from "./usecaseLoader";
import { DECISION_MAKER_VIEW_GUIDE } from "./revisePromptBuilder";

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
    header(meta, productId, "功能与用例"),
    `## 你的任务
你是 Atlas 的大 Agent。基于产品描述,生成 Atlas **五层骨架**的功能与用例骨架,**严格遵守 feature-source-contract + capability-contract + usecase-contract + actor-contract**。

## 五层骨架 (v0.1 rev3)

\`\`\`
Project
  ├── Actor               (项目级 first-class, actors/<id>.md)
  ├── Entity              (existing, entities/<id>.md 或 modules/<m>/entities/<id>.md)
  └── Domain → Capability (业务能力, capabilities/<id>.md, 跨 module 合法)
              └── Function    (modules/<m>/features/<f>.md, 必须 capability_id 归属)
                    └── UseCase  (modules/<m>/usecases/<scenario>.md, 可空)
\`\`\`

**Domain 预定义池** (规则 2): 招生 / 教务 / 财务 / 人事 / 数据集成 / 决策与报表 — 必从中选, 实在不属于的显式新增

**module** 不再是结构骨架的一层, 只作物理目录 + 团队归属维度。 真正的层级是 domain → capability → function → usecase。

## 强制规则

1. **Function.id 产品内全局唯一** (规则 1) — 不能跨 module 重名
2. **每个 function 必须有 capability_id** (规则 6a) — 不允许"无归属"function
3. **每个 function 必须有 actor_ids[]** — 列出参与的 actor id, 这些 actor 必须先在 actors/ 中存在
4. **Capability 粒度** (规则 8): 一个 capability 下 3-10 个 function 为健康
5. **UseCase 拆分规则** (规则 7): 见 usecase-contract §3 — 同动作不同 actor 发起 / 不同前置条件 / 不同数据流向才拆, 不拆字段差/UI 差/状态机一边差

## 工作流要求

1. 先输出**生成计划**:
   - 列你要建几个 Actor (含 type / responsibilities)
   - 列几个 Domain + 每个 Domain 下的 Capability (含 value_statement / actor_ids / entity_ids / priority)
   - 每个 Capability 下挂哪些 Function (含 actor_ids / entities_touched)
   - 哪些 Function 需要拆 UseCase (含 actor_id / scenario id / precondition)
   - 文件路径预览
2. **等用户确认后再实际写文件**(用 Edit/Write 工具)
3. 严格遵守输出约定
4. 新建文件不加 needs_revision 标签
5. 每个 function 都必须写 \`## 给决策者\` 段, **严格按下方写作规范**, 三段格式 + 不出现 schema 黑话
`,
    "",
    DECISION_MAKER_VIEW_GUIDE,
    "",
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

- entities_touched 用 PascalCase 规范名(同表多名规则: 同一持久化边界 → 一个规范名)
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
 *   - questions.md(诊断单,trigger 模式见 entity-contract §6.3)
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

  // 第 5 类输入 — 决策者已拍板的 question 决策(对偶 entity-contract §2.5)
  // 全局需求池 entity 段: accept/custom 决策落地
  // sidecar questions-decisions.yml: reject 决策落地
  const globalFeedback = await parseGlobalFeedbackFile(productId);
  const entityFeedback = globalFeedback.entity;
  const entityFeedbackText = entityFeedback.length === 0
    ? "(无 — 决策者尚未对实体相关 question 做过决策)"
    : entityFeedback
        .map((g) => `- **${g.id}** (${g.date}): ${g.content}`)
        .join("\n");

  const questionsDecisionsText = (await readTextFile(
    "products",
    productId,
    "derived",
    "entities",
    "questions-decisions.yml"
  )) ?? "(无 questions-decisions.yml — 决策者尚未驳回过任何 question)";

  // v0.1 rev3 第 6/7/8 类输入: Actor / Capability / UseCase (五层骨架)
  const actors = await loadActors(productId);
  const capabilities = await loadCapabilities(productId);
  const usecases = await loadUseCases(productId);
  const capabilitiesWithRefs = attachCapabilityRefs(
    capabilities,
    // 收集全部 function 用于反向聚合
    (await Promise.all(modules.map((m) => loadFeatures(productId, m.name)))).flat()
  );

  const actorsText = actors.length === 0
    ? "(无 — 项目级 actors/ 目录尚未建立, 五层骨架不完整)"
    : actors
        .map((a) => `- **${a.id}** [${a.type}]: ${a.name}${a.responsibilities ? ` — ${a.responsibilities}` : ""}`)
        .join("\n");

  const capabilitiesText = capabilitiesWithRefs.length === 0
    ? "(无 — 项目级 capabilities/ 目录尚未建立)"
    : capabilitiesWithRefs
        .map((c) => {
          const fns = c.function_ids.length > 0 ? c.function_ids.join(", ") : "(无 function)";
          return `- **${c.id}** [${c.domain} · ${c.priority} · ${c.status}]: ${c.name} — actors: [${c.actor_ids.join(", ")}], entities: [${c.entity_ids.join(", ")}], functions: ${fns}\n  > ${c.value_statement}`;
        })
        .join("\n");

  const usecasesText = usecases.length === 0
    ? "(无 UseCase — function 都是简单形态, 没有场景化拆分)"
    : usecases
        .map((u) => `- **${u.module}/${u.function_id}::${u.id}** (actor: ${u.actor_id}): ${u.precondition ? `前置: ${u.precondition} | ` : ""}${u.postcondition ? `后置: ${u.postcondition}` : ""}`)
        .join("\n");

  const rolesList = registry.roles
    .map((r) => `- ${r.name} (id: ${r.id})${r.note ? ` — ${r.note}` : ""}`)
    .join("\n");

  const contractText = await readEntityContractText();

  const outputDir = `data/products/${productId}/derived/entities/`;
  const today = new Date().toISOString();

  const parts = [
    header(meta, productId, "Path C 实体派生"),
    `## 你的任务
你是 Atlas 的 Path C **实体派生 Agent**。基于产品的 5 类 source 输入(features × N / SEAMS / DECISIONS /
ENTITIES-OWNERSHIP / GLOBAL-FEEDBACK[entity 段] + questions-decisions.yml),产出 derived 实体清单 + reconcile 报告 + questions。

输出文件(全部写到 \`${outputDir}\`):
1. \`<EntityName>.md\` — 每实体一个文件(见下方契约 §3)
2. \`questions.md\` — 诊断单(trigger lint 见 entity-contract §6.3)
3. \`reconcile-report.md\` — 派生 vs 声明的差异(见契约 §4)

工作流要求:
1. 先输出**派生计划**:
   - 列你打算派生的所有实体 + 它们的命名映射表(PascalCase 规范名, 同表多名规则)
   - 列你打算抛多少 question?对应哪些 source?(若有 GLOBAL-FEEDBACK entity 决策已覆盖,**不要再抛**)
   - 列预期 reconcile 差异:派生有声明无 N1 / 声明有派生无 N2 / 归属不一致 N3
2. **等用户确认后**再用 Edit/Write 工具实际写文件
3. 严格遵守契约。**派生只读 — 不要回写 features/SEAMS/DECISIONS/ENTITIES-OWNERSHIP/GLOBAL-FEEDBACK**
4. 缺数据 → 标 \`[TBD]\` + 写 questions.md ticket;**不要"业务常识"补**
5. 命名规范以 PascalCase 同表多名规则为准 — 同一持久化边界 → 一个规范名, 不同持久化边界 → 拆开
6. 每个 entity md 必须含 frontmatter \`name / layer / maintainers / sourceFeatures[] / generated_at\`(其余字段可选)
7. **entity md 是纯数据规格**(rev3 决策者反馈定型 · 见下方"§ 实体 = schema"专段) — body 结构: \`## 字段\` + (可选) \`## 状态机\` + (可选) \`## 权限\` + (可选) \`## 引用决策\` + (可选) \`## 引用接缝\`。**不要写 \`## 给决策者\` 段**, 不要写"做什么 / 取舍 / 待你拍"段, 不要写业务故事 — 那些已经在 features 的"给决策者"里, 实体不重复。
8. 当前生成时间(写入 generated_at): ${today}

## ⚠ 多 feature 描述同一动作 → 不要派生为不同 Entity

立项阶段 features 集合常有"同一动作的多个切面"(actor 不同 / 触发点不同 / 数据范围不同, 但本质操作同一实体)。例:
- \`refund-application(销售发起入口)\` + \`refund-three-party\` + \`refund-batch-import\` → 派生为同一个 Refund 实体, 用**字段权限**区分 actor, 用**状态机分支**区分流程

判别原则:
1. entities_touched 重合 ≥ 70% 的多个 features → 合并派生到同一 Entity, 在 Entity 的字段权限 / 状态机分支体现差异
2. 不同 features 触及同一主体实体 → sourceFeatures 列表合并, 一个 Entity 多个 sourceFeatures 是正常的
3. **不要**为了 features 数量平衡而拆 Entity — 一个 Refund 实体覆盖 N 个退费 features 比 N 个 RefundXxx 实体好

## ⚠ 消化决策者已拍板的决策(对偶 entity-contract §2.5)

下方 "全局需求池(entity 段)" + "questions-decisions.yml" 是决策者上一轮对 questions.md 的决策结果:

- **GLOBAL-FEEDBACK entity 段每条** = 决策者 accept agent 建议 或 custom 自填的决策。**视为已解决的 question**:
  - 必须把决策合入对应实体规格(字段必填性 / 关系建模 / 状态机分支 / 归属层 等)
  - 在被影响的实体 .md 的相关位置留 \`<!-- Agent note: 来自全局需求池 gfb-YYYYMMDD-xxxxxx -->\` 注释 trail
  - **本轮 questions.md 不要再以同样形式抛出该问题**
  - **合入完成后, 直接编辑 \`GLOBAL-FEEDBACK.md\`, 在 \`## 实体需求\` yaml 块里删掉已合入的 gfb 条目**(跟 feature-revise 一致, 见下方"§ pool 清理"专段)。 池子里不该留已应用条目, 否则 UI 永远显示"N 条待处理"。
- **questions-decisions.yml 中 status: rejected 的条目** = 决策者认为不是业务问题(agent 抛错了):
  - 同样的 question 本轮**不要再抛**
  - 该问题如果还需要处理, 自决(纯工程决策)或在 entity .md 加 Agent note 留 trail

## § pool 清理(跟 feature-revise 一致)

派生完成、所有 GLOBAL-FEEDBACK entity 段决策都合入 entity .md 后, **直接编辑 \`data/products/<productId>/GLOBAL-FEEDBACK.md\`**:

1. \`## 实体需求\` yaml 块里, **删除本轮已合入的全部 gfb 条目**(留 \`<!-- Agent note -->\` 痕迹在 entity .md 已经足够追溯, pool 不该留死条目)
2. 没合入的 / 你判断"暂不采纳"的条目: 保留, 但在 diff plan 里说明理由
3. yaml 块为空时: 写 \`[]\`(不是删段)
4. 更新 frontmatter \`last_updated\` 为今天日期(\`2026-MM-DD\` 格式)
5. \`## 功能点需求\` / \`## 原型需求\` 两段你不要碰

**为什么**: pool 是给"待 agent 处理"的队列, 不是决策档案。 决策档案在 entity .md 的 Agent note + DECISIONS.md。 池子留死条目会让决策者 UI 显示"N 条待处理"误导。

## § 实体 = schema(决策者反馈定型 · rev3)

**实体 .md 是给程序员看的 schema, 不是给决策者看的业务文档。** 决策者的视图全部在两个地方:
1. **功能与用例 tab** — 业务流程 / 权限 / 关键取舍 / 待拍点都在 features 的 \`## 给决策者\` 段
2. **实体 tab 顶部 questions.md** — 实体派生过程中需要业务方拍的事(架构边界 / 新建模决策 / 跨 feature 不一致 / 完全无线索) 全部走这里

**实体 .md body 只允许这些段**(按出现顺序):
\`\`\`
# <EntityName>

派生于:
- features × N
- seams × M(可选)
- decisions × K(可选)

## 字段
| 字段 | 类型 | 必填 | 约束 | 备注 | 来源 |
| --- | --- | --- | --- | --- | --- |
...

## 状态机(可选 — 仅有状态转移时写)
| from | to | 触发 | 角色 | 来源 |
...

## 权限(可选 — 跨角色字段权限或行级权限时写)
...

## 引用决策(可选)
- D-XX: ...

## 引用接缝(可选)
- X.Y: ...

## 来源 features(可选 — 已在 frontmatter.sourceFeatures, 这里写不写都行)
\`\`\`

**严禁出现的段**(出现 = 重写):
- ❌ \`## 给决策者\`
- ❌ "做什么 / 取舍 / 待你拍" 任何形态
- ❌ 业务故事描述段
- ❌ 任何"用白话讲讲这个实体是干嘛的"段落

**任何需要业务方拍的事 → 走 questions.md, 不进 entity .md**。 实体卡上只显示字段、状态机、约束 — 决策者读的是顶部 question 列表。

**判别金句**: 实体 .md 应该读起来像 SQL DDL 注释, 不像产品文档。

## ⚠ 抛 question 前必读(见 entity-contract §6.3.5)

**用户做业务规则决定,不做 schema/工程决定**。

抛 question 前必过 5 级自检:
1. feature.md / SEAMS / DECISIONS / ENTITIES-OWNERSHIP 中有答案? → 有,自决
2. 已有 entity .md / 既往派生历史中有答案? → 有,自决
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
- ❌ "ENTITIES-OWNERSHIP 表里声明无派生的 X 还需要吗?"(reconcile 报告里你自己写"已被 X 替代 / v0 不做"的判断 = 已自决, 不要再抛)
- ❌ "派生有声明无的 N 个实体是否加入归属表?"(归属表同步是 agent 元工作, 不是决策者业务, 把建议直接写进 reconcile-report 的"建议 layer"列即可)
- ❌ "Lead 的 layer 是机构层还是校区?"(看 features 是否跨校区使用即可自决 — 没线索就标 [TBD] + agent note, 不抛 question)

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
    "### GLOBAL-FEEDBACK.md · ## 实体需求(决策者已 accept/custom 的决策 — 视为已解决 question)",
    entityFeedbackText,
    "",
    "### derived/entities/questions-decisions.yml(决策者已 reject 的 question — 本轮不要再抛)",
    "```yaml",
    questionsDecisionsText,
    "```",
    "",
    "### actors/(项目级 Actor 池 — 五层骨架的 Actor 层)",
    actorsText,
    "",
    "### capabilities/(业务能力 — Function 的归属层)",
    capabilitiesText,
    "",
    "### modules/<m>/usecases/(业务场景 — Function 的子层, 可空)",
    usecasesText,
    "",
    "---",
    "",
    "## 必读 · entity-contract 全文 (inline)",
    "",
    contractText,
    "",
    "---",
    "",
    "注:契约 §3.3 提到的 `## 给决策者` 段在 rev3 后**已废弃**(决策者反馈定型)。 实体 .md 是纯 schema, 决策走 questions.md。 契约文档将后续 sync, 但 prompt 规则以本文为准 — 见上方 § 实体 = schema 专段。",
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
      "- 派生只读,**不要回写** features/SEAMS/DECISIONS/ENTITIES-OWNERSHIP/GLOBAL-FEEDBACK\n- 不要碰 sidecar(review-state.yml / questions-decisions.yml)— 那是 UI 写的审阅元数据\n- 缺数据宁可标 [TBD] + 走 questions.md,不要凭'业务常识'补\n- 命名规范: PascalCase 同表多名规则 (entity-contract §3.4)\n- **实体 .md 是纯 schema**(rev3 决策者反馈) — 不写 ## 给决策者 段, 不写 做什么/取舍/待你拍, 决策点全部走 questions.md\n- 全局需求池 entity 段每条决策必须合入相关实体规格 + 留 `<!-- Agent note: 来自全局需求池 gfb-xxx -->` trail"
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
