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
import { AGENT_SELF_DECISION_PRINCIPLE, DECISION_MAKER_VIEW_GUIDE } from "./revisePromptBuilder";
import { buildDomainContext } from "./domainContext";

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
  | "entity-derive"
  | "screen"
  | "concept-reference";

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

async function header(productMeta: ProductMeta | null, productId: string, stage: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const productLine = productMeta ? `${productMeta.name} (${productId})` : productId;
  const workdir = path.join(atlasRoot, "data", "products", productId);
  const domain = await buildDomainContext(productMeta, productId);
  return [
    `# Atlas ${stage}生成任务`,
    "",
    "## 上下文",
    `- 产品: ${productLine}`,
    `- 工作目录: ${workdir}/`,
    `- 当前时间: ${today}`,
    `- 阶段: ${stage}(从零生成)`,
    "",
    domain,
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
    await header(meta, productId, "功能与用例"),
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
6. \`## 给决策者\` 的 \`**待你拍**\` 段过 AGENT_SELF_DECISION_PRINCIPLE 5 级自检 — 默认值 / 工程决策 / 上下文有答案的全部 agent 自决, 不灌水, 每 feature ≤ 3 条
`,
    "",
    AGENT_SELF_DECISION_PRINCIPLE,
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
    await header(meta, productId, "实体"),
    `## 你的任务
你是 Atlas 的实体 Agent。基于产品的全部 **features**,识别出业务**实体**(Entity),
为每个实体生成 entity md 文件。

${AGENT_SELF_DECISION_PRINCIPLE}

## ⚠ 实体 .md 是纯 schema (rev3 决策者反馈定型)

**严禁出现**: \`## 给决策者\` / "做什么 / 取舍 / 待你拍" / 业务故事段。 决策点全部走 questions.md / 抛业务 question(若有), 不进 entity .md。

判别金句: 实体 .md 应该读起来像 SQL DDL 注释, 不像产品文档。

工作流要求:
1. 先输出**生成计划**:打算识别哪些实体、放在顶层(共享)还是放在某 module 下、关键字段与关系
2. **等用户确认后再实际写文件**
3. 每个 entity.md 必须含 \`## 字段\` 表格(5 列: 字段名 / 类型 / 必填 / 约束 / 备注)、
   \`## 关系\` 列表、\`## 决策\` 列表;末尾加空 \`## 反馈池\` 段(yaml 块 [])
4. 不确定的字段在备注列写 \`[TBD]\`,parser 会识别为 TBD
5. 默认值能跑的(字段长度 / 必填阈值 / 上限)按 AGENT_SELF_DECISION_PRINCIPLE 默认值清单选, 写到字段约束/备注列, 不抛
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
    await header(meta, productId, "L0 规范"),
    `## 你的任务
你是 Atlas 的规范 Agent。基于现有 **features + entities**,识别出该产品级别的**规范约束**(L0),
生成 \`CONVENTIONS.md\`。L0 是 Agent 在 L1(实体)/ L2(功能点)操作时必须遵循的硬约束基线。

${AGENT_SELF_DECISION_PRINCIPLE}

工作流要求:
1. 先输出**生成计划**:打算从哪些 features/entities 中归纳哪几条规范
2. **等用户确认后再实际写文件**
3. 输出文件: \`data/products/${productId}/CONVENTIONS.md\`
4. frontmatter 写 \`spec_level: 0\` 和 \`version: 1\`(或递增)+ \`last_updated\`
5. 不要把无法落到约束的"经验性建议"写进 L0;L0 只装"硬约束"
6. 识别出的规范如有歧义, **agent 选最严格可执行的版本**, 加 \`<!-- Agent note: 选 X 而非 Y, 因 ... -->\` 留痕, **不抛 question**。 CONVENTIONS.md 是 agent 归纳的硬约束基线, 不该有 pending 决策。
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
    await header(meta, productId, "Path C 实体派生"),
    AGENT_SELF_DECISION_PRINCIPLE,
    "",
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

## ⚠ 实体派生场景特有的反例(在 AGENT_SELF_DECISION_PRINCIPLE 之外补充)

通用 5 级自检 / 默认值清单 / 一般工程反例已在 prompt 顶部 § Agent 自决原则 段, 那里已经禁了"字段类型 / FK 方向 / 状态机一边" 这种工程问题。

实体派生场景**特别要注意的反例**(不许抛):
- ❌ "ENTITIES-OWNERSHIP 表里声明无派生的 X 还需要吗?"(reconcile 报告里你自己写"已被 X 替代 / v0 不做"的判断 = 已自决)
- ❌ "派生有声明无的 N 个实体是否加入归属表?"(agent 元工作 — 把建议直接写进 reconcile-report 的"建议 layer"列, 不抛)
- ❌ "Lead 的 layer 是机构层还是校区?"(看 features 是否跨校区使用即可自决; 没线索 → 标 [TBD] + agent note)

**真业务正例**(可以抛):
- ✅ "推荐人改名后, 推荐关系字段保持 id 还是写历史 name?"(业务规则: 历史可追溯 vs 当前一致性)
- ✅ "SEAMS §5.6 三边契约里财务先动还是教务先动?"(业务流程)
- ✅ "Entitlement 撤销时, 关联的 AttendanceRecord 是删还是留作历史?"(业务约束)
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


/**
 * Screen Generate prompt (v0.1 / 原 prototype 占位实化)。
 *
 * 设计:
 *   - Step 1 强制拆分判断, 2 个锚定反例避免合并偏向
 *   - Step 2 按 schema 产出 Screen markdown
 *   - usecase 信息密度不足 → **降级而非 STOP**: 输出 draft + 弱信号标注 + 反馈池追加 revise 建议
 *   - 读盘风格: prompt 不内联 usecase 全文, agent 自己读 modules/<m>/usecases/*.md
 */
export async function buildScreenGeneratePrompt(productId: string): Promise<GenerateResult> {
  const meta = await loadMeta(productId);
  const stats = await collectStats(productId);
  const usecases = await loadUseCases(productId);
  const usecasesIndex = usecases
    .map((u) => `- **${u.module}/${u.id}** (function: ${u.function_id}, actor: ${u.actor_id})${u.precondition ? ` · 前置: ${u.precondition}` : ""}`)
    .join("\n");
  const workdir = path.join(atlasRoot, "data", "products", productId);

  const prompt = [
    await header(meta, productId, "界面屏 Screen"),
    AGENT_SELF_DECISION_PRINCIPLE,
    "",
    `## 你的任务

你是 Atlas 的 Screen 推导 Agent (v0.1 双轨设计 · 界面轨)。 任务:基于产品现有 usecase + entity, 识别应当抽象为 Screen 的 usecase 簇, 产出 \`modules/<m>/screens/<screen-id>.md\` 文件。

**工作目录**: ${workdir}/

## Step 1 · 拆分判断(强制先输出)

在产出任何 Screen md 之前, 先扫所有 usecase, 决定:**这些 usecase 应该映射到几个 Screen?**

判断标准(3 档定性):
- **字段几乎一致 + 同一类用户视角** → 合并为一个 Screen
- **字段部分重合 + 操作目的不同** → 拆为多个 Screen
- **字段几乎不重合 / 跨多角色 + 视图差异显著** → 各自独立 Screen

### 锚定反例 1(应拆)
\`douyin-enrollment\` / \`offline-enrollment\` / \`student-profile-edit\` 三个 usecase 都涉及 Student 实体, 但:
- 前两个是**录入流程**(字段密集 + 表单 + 校验), 一个 Screen「学员录入页」
- 后一个是**档案查看 + 局部编辑**(字段稀疏 + 只读为主 + 权限分级), 另一个 Screen「学员档案页」
→ 拆 2 个 Screen, 而非合 1 个

### 锚定反例 2(不应拆)
\`refund-by-sales-wechat\` / \`refund-by-sales-bank-transfer\` 两个 usecase 都是销售发起的退费, 仅退款渠道不同(微信 vs 对公转账)。
- 字段几乎一致(原因 / 金额 / 凭证)
- 同一 actor 视角
→ 合 1 个 Screen「退费申请页」, 不拆

**默认偏向**: 模型容易"合并偏向"(token 省 + 看起来整洁), 你**应当主动拆**, 除非两个 usecase 真的字段几乎一致 + 同视角。

### Step 1 输出格式

\`\`\`
## 拆分判断
- 候选 Screen 数: N
- Screen 列表:
  1. {screen-id-1} (module: <m>): 承接 [usecase-a, usecase-b]
     - 拆分理由: ...
  2. {screen-id-2} (module: <m>): 承接 [usecase-c]
     - 拆分理由: ...
- 跨 module 共享屏(若有): {screen-id-x} module: shared
\`\`\`

**渐进产出允许**: 不要求一次出完产品全部 Screen — 可单 usecase → 单 Screen 渐进推进, 后续轮次扩展。 但当前轮 Step 1 必须显式声明 "本轮处理范围:[usecase-x, usecase-y]"。

**Hub 屏例外**: 「销售工作台 / 教务首页 / 我的待办」这类聚合 N 个 usecase 入口的 hub 屏是有效 Screen 形态, entity_visibility 只列入口所需的轻量字段(列表项摘要), 详细操作走对应叶子 Screen。

## Step 2 · 为每个 Screen 生成 markdown

**先输出 diff plan**, 等用户确认后再 Edit/Write。

### 文件位置
\`modules/<module-id>/screens/<screen-id>.md\` — 单 module 屏放对应 module
\`modules/shared/screens/<screen-id>.md\` — 跨模块共享屏放 shared 目录(**本期不自动 mkdir shared/**, 见 §强约束)

### Frontmatter Schema(严格)

\`\`\`yaml
---
id: <kebab-case>                  # 必填, module 内唯一
name: <中文名>                    # 必填
module: <module-id>               # 必填, 或 "shared"
usecase_ids:                      # 必填至少 1
  - <usecase-id-1>
entity_visibility:                # 必填至少 1 个 entity
  <EntityName>:
    default: [<field1>, <field2>] # 所有 actor 默认露出
    role_gated:                   # 可选, 按 actor id gate
      <actor_id>: [<field-x>]
    derived_fields: [<label>]     # 可选, 派生字段单列(必须为 entity 字段表中 derived 标记的字段)
prototype_url: null               # 留 null, 不写 Figma 链接
preview_image: null               # 留 null
added_in_phase: planning
added_at: <YYYY-MM-DD>
---
\`\`\`

### Body 7 段(缺一不可)

1. **## 用途** — 一句话
2. **## 拆分理由** — 来自 Step 1 输出
3. **## 信息架构** — 顶部 / 主体 / 侧栏 / 底部各承载什么(纯文本, 不写 CSS)
4. **## 字段可见性补充说明** — 仅当 frontmatter 矩阵不够表达时用(如"管理员视图下 id_number 仅在编辑模式露出"); 否则写"(略, 见 frontmatter.entity_visibility)"
5. **## 状态变体** — \`loaded\` / \`empty\` / \`loading\` / \`error\` / \`no_permission\` 每个状态界面表达
6. **## 设计决策** — 关键 trade-off
7. **## 反馈池** — 空池:\`\`\`yaml\\n[]\\n\`\`\`

## 信息密度不足时 — 降级(不阻断)

若某 usecase 缺乏 Section A 步骤序列 / Section A 中无字段读写 / entity 字段表为空, **不要 STOP**, 改为:
- 仍产出该 Screen 的 markdown 草稿
- frontmatter 增加: \`needs_revision: true\`
- body 第 6 段「设计决策」中标注:\`⚠️ 以下字段基于 feature.entities_touched 推断, usecase 未明确 — 信号弱, 建议先 revise usecase\`
- 同步往对应 usecase 反馈池追加一条:\`Screen <screen-id> 生成时发现本 usecase 信息密度不足, 需要补 Section A 字段读写信息\`
  (通过 \`POST /api/products/${productId}/feedback\` body \`{ target: "usecase:<m>:<fn>:<u>", content: "..." }\`)

## 强约束

- 所有字段名**必须**来自 entity \`## 字段\` markdown 表(读 \`derived/entities/<EntityName>.md\`), 不发明
- \`entity_visibility.<E>.default\` 覆盖范围 = **本 screen UI 上会渲染的所有字段**(R 读 + W 写都算), 不只是写字段。 列表/摘要场景的字段也算
- \`derived_fields\` 中的字段必须在 entity 字段表中标 derived
- \`role_gated\` 的 key 必须是产品 \`actors/\` 目录里存在的 actor id(kebab-case), 校验器会查
- 跨 module 共享屏(\`module: shared\`):若发现两个 module 的 usecase 共享一屏, **写入 frontmatter \`split_suggestion: "..."\` 交人决策**, 本期不自动 mkdir shared/ 目录, 不写 \`module: shared\` 的 Screen 文件

## API 落盘格式

\`POST /api/products/${productId}/screens\` body 示例:

\`\`\`json
{
  "id": "refund-application",
  "name": "退费申请页",
  "module": "sales",
  "usecase_ids": ["refund-by-sales"],
  "entity_visibility": {
    "RefundApplication": {
      "default": ["application_id", "status", "reason"],
      "role_gated": { "finance": ["processed_by_finance"] },
      "derived_fields": []
    }
  },
  "body": "## 用途\\n...\\n## 拆分理由\\n..."
}
\`\`\`

响应 201 + \`{ data, validation_issues: [] }\` 表示通过; 400 + \`issues: [...]\` 列出阻断级错误。

## 禁止

- 写 Figma 链接 / 设计稿 url(\`prototype_url\` 留 null, 后续手动填)
- 写 CSS / 颜色值 / 字体规格 / 像素值
- 引用 usecase 未涉及的 entity 字段
- 自动跨 module 合并 Screen
- 把 ui_states 列在 frontmatter(本期降到 body \`## 状态变体\` 段)

## 当前产品的 usecase 索引(供拆分判断扫描)

${usecases.length === 0 ? "(无 — 请先 revise / 补 usecase 后再来生成 Screen)" : usecasesIndex}

## 当前产品的 entity 索引

读 \`derived/entities/\` 下 PascalCase 文件名, 字段在 \`## 字段\` markdown 表中(parser 已经能解, 用 grep / Read 自己取)。
`
  ].join("\n");

  return { prompt, stats };
}

/**
 * UseCase Generate prompt (v0.1 双轨设计 · 业务轨补全)。
 *
 * 补双轨梯子缺的一格: 从 function(feature)反推 usecase。 screen-generate 从 usecase 反推屏,
 * 但 usecase 这层之前没有"从功能反推"的 agent, 导致没用例的功能出不了屏。
 *
 * 设计:
 *   - 只针对**没有任何 usecase 的 function**(已有 usecase 的不动)
 *   - Step 1 强制判断: 哪些 function 该补 usecase / 补几个(按 usecase-contract §3 拆分规则)
 *   - 严守"可空"原则: 纯入口 / 纯聚合视图 / 纯查询 function 不强行造 usecase
 *   - 读盘风格: agent 自己读 features / usecases, prompt 只给索引
 */
export async function buildUseCaseGeneratePrompt(productId: string): Promise<GenerateResult> {
  const meta = await loadMeta(productId);
  const stats = await collectStats(productId);
  const modules = await loadModules(productId);
  const usecases = await loadUseCases(productId);

  const ucCountByFn = new Map<string, number>();
  for (const u of usecases) ucCountByFn.set(u.function_id, (ucCountByFn.get(u.function_id) ?? 0) + 1);

  const bareLines: string[] = [];
  const coveredLines: string[] = [];
  for (const mod of modules) {
    const features = await loadFeatures(productId, mod.name);
    for (const f of features) {
      const n = ucCountByFn.get(f.id) ?? 0;
      if (n > 0) {
        coveredLines.push(`- [${mod.name}/${f.id}] ${f.name} (已有 ${n} usecase)`);
        continue;
      }
      const actors = (f.actor_ids ?? f.roles ?? []).join(", ") || "(未指定)";
      const desc = f.description.trim().replace(/\s+/g, " ").slice(0, 160);
      bareLines.push(
        `- [${mod.name}/${f.id}] ${f.name} · actors: [${actors}]${f.capability_id ? ` · capability: ${f.capability_id}` : ""}${desc ? `\n    ${desc}` : ""}`
      );
    }
  }

  const prompt = [
    await header(meta, productId, "业务用例 UseCase"),
    AGENT_SELF_DECISION_PRINCIPLE,
    "",
    `## 你的任务

你是 Atlas 的 UseCase 推导 Agent (v0.1 双轨设计 · 业务轨)。 任务:对**当前没有任何 usecase 的 function(功能点)**, 按业务场景反推 usecase, 产出 \`modules/<m>/usecases/<scenario-id>.md\`。

严格遵守 **usecase-contract**(\`docs/usecase-contract.md\`)。已有 usecase 的 function **不要动**。

## Step 1 · 补全判断(强制先输出)

逐个扫"无用例 function", 对每个判断:**该不该补 usecase?补几个?**

### 该补几个 — 按 usecase-contract §3 拆分规则

**应拆为多个 usecase(§3.1)**:
- 同动作**不同 actor 发起**(销售提 vs 教务发起)
- 同动作**不同前置条件 / 业务路径**(抖音渠道录入 vs 线下渠道录入)
- 同动作**不同数据流向 / 外部系统**(微信原路退 vs 对公转账)

**不拆, 合一个(§3.2)**:仅字段差 / 仅 UI 入口差 / 仅状态机一条边差 → 用 function 自身的段表达, 不拆 usecase。

**判断公式(§3.3)**:两个场景主流程步骤超过 2 步不同 / precondition 导致进入路径完全不同 / postcondition 涉及完全不同下游 → 拆;否则合一个。

### ⚠️ "可空"原则(usecase-contract §1.3)—— 不要为凑数硬造

**简单 function 不挂任何 usecase 是合法且正确的**:
- 纯入口 / 导航页、纯聚合视图(看板/列表)、纯查询、纯配置项 → 通常**不需要** usecase, 它们的行为已在 function 描述里说清
- 只有当 function 承载**有步骤序列的业务场景**(录入流程、审批流、状态流转、跨角色协作)时, 才补 usecase
- 宁可一个 function 0 usecase, 也不要造一个"主流程就 1-2 步、跟 function 描述重复"的水 usecase

### Step 1 输出格式

\`\`\`
## 补全判断
本轮处理范围: [function-a, function-b, ...]
- function-a (module: <m>): 补 N 个 usecase
  - {usecase-id-1}: actor=<actor_id>, precondition=<...>  ← 拆分理由
  - {usecase-id-2}: actor=<actor_id>, precondition=<...>
- function-b (module: <m>): 0 usecase — 理由: 纯聚合视图, 无步骤序列
\`\`\`

**渐进产出允许**: 不要求一轮补完全部 function, 但必须显式声明本轮范围。

## Step 2 · 为每个 usecase 生成 markdown

**先输出 diff plan, 等用户确认后再 Edit/Write。**

### 文件位置与命名(usecase-contract §4)
- 路径: \`modules/<module-id>/usecases/<scenario-id>.md\`(与 features/ 平级)
- 文件名 = **场景关键词**, 不带 function_id 前缀(✅ \`douyin-channel.md\` ❌ \`student-intake-douyin.md\`)
- \`id\` = 文件名(kebab-case), function 内唯一

### Frontmatter(usecase-contract §2)

\`\`\`yaml
---
id: <scenario-id>                 # 必填, 与文件名一致
function_id: <feature-id>         # 必填, 真源, 裸 id 不带 module 前缀
actor_id: <actor_id>             # 必填, 主参与者(单数!其他角色在主流程步骤里说明)
entity_ids:                       # **强烈建议填**: 列出本用例主流程实际读写的实体(从你写的步骤里提到的实体名提取)
  - <Entity>                      #   下游界面屏靠它锚定实体 — 留空且 function.entities_touched 也空时, 屏会校验报错
precondition: <进入这个场景的前置条件>
postcondition: <这个场景结束后的状态>
source: agent_suggested
added_in_phase: planning
added_at: <YYYY-MM-DD>
---
\`\`\`

### Body 段(usecase-contract §2)

\`\`\`markdown
# <场景中文名>

## 主流程
1. <步骤 1>
2. <步骤 2>
（目标 8 步;超过 12 步说明该拆, 写 frontmatter.split_suggestion 交人决策, 不硬塞)

## 备选流程
- <条件 A> → <走法>
- <异常分支> → <处理>

## 备注
<数据流向特殊点 / 外部系统集成 / 异常处理, 没有可省>

## 反馈池

\`\`\`yaml
[]
\`\`\`
\`\`\`

## 强约束

- \`actor_id\` 必须是产品 \`actors/\` 里存在的 actor id, 且应在该 function 的 actor_ids 范围内
- \`function_id\` 必须是真实存在的 feature id(裸 id)
- **单主 actor**: usecase 只有 1 个主 actor, 不写 secondary_actor_ids;协作角色在主流程步骤文字里点名
- **entity_ids 尽量填全**: 凡主流程步骤里读/写到的实体(如"保存 PaymentRecord"→ PaymentRecord, "选择订单"→ Order)都列进 entity_ids, 不发明不存在的实体名。这是下游界面屏的实体锚点, 漏填会让屏校验报 entity-not-referenced-by-usecase
- 新建文件**不写** needs_revision(新建即基线)

## 落盘方式

直接用 Edit/Write 写文件, 或 \`POST /api/products/${productId}/usecases\`(body 含 module + function_id + scenario id + body)。 写完每个文件**必须**用 Bash 调 \`POST /api/agent/validate/usecase\` 校验, 不通过就改到通过。

## 当前【无用例】的 function(本次补全目标, 共 ${bareLines.length} 个)

${bareLines.length === 0 ? "(无 — 所有 function 都已有 usecase 或不需要)" : bareLines.join("\n")}

## 已有 usecase 的 function(**不要动**)

${coveredLines.length === 0 ? "(无)" : coveredLines.join("\n")}
`,
    "",
    FOOTER(productId, "- 只补 usecase, 不改 features / actors / entities\n- 已有 usecase 的 function 一律不碰\n- 可空原则: 简单 function 留 0 usecase 是对的, 别造水 usecase")
  ].join("\n");

  return { prompt, stats };
}

/**
 * v0.1 兼容别名 — 旧 scope "prototype" 仍可调用, 内部转发到 Screen generate。
 * v0.2 完成迁移后可删。
 */
export async function buildPrototypeGeneratePrompt(productId: string): Promise<GenerateResult> {
  return buildScreenGeneratePrompt(productId);
}

/**
 * 概念参考图 Generate prompt (concept-reference)。
 *
 * 用途要点: codex **不再产出生产原型**, 只产 3–4 张概念参考图(mood board)给 Atlas 吸收。
 * 每页的生产图由 Atlas 自己用冻结壳 + 内容区渲染(见 scripts/render-shell.mjs), codex 的随机性因此无害化
 * (参考图本就该多样, 一张都不上线)。提示词内含保存绝对路径, codex 客户端落图后 Atlas 读取参考。
 */
export async function buildConceptReferencePrompt(productId: string): Promise<GenerateResult> {
  const meta = await loadMeta(productId);
  const stats = await collectStats(productId);
  const modules = await loadModules(productId);
  const conceptsDir = path.join(atlasRoot, "data", "products", productId, "shells", "v1", "concepts");
  const dirList = modules.length
    ? modules.map((m) => `- ${m.title || m.name}${m.role ? `(${m.role})` : ""}`).join("\n")
    : "- (模块待补)";

  const prompt = [
    await header(meta, productId, "概念参考图"),
    `## 角色
你是资深 B 端 SaaS 视觉设计师, 为「${meta?.name ?? productId}」产出**概念参考图**。

## 用途(关键 — 决定你怎么画)
这些图是**设计参考(mood board), 不是要交付的生产原型**。研发侧已有固定前端壳(左侧导航 196px + 内容区), 会照你的视觉方向自行实现每一页。所以:
- 只产出 **3–4 张**高质量概念图, 覆盖几种页面原型, 把视觉语言立住即可。
- **不要画全部页面**; 各张**不必互相一致** —— 每张各展所长, 由我综合吸收。
- 重点给: 配色、留白密度、卡片/表格/表单的组件质感、状态徽章、图标风格、数据可视化点缀。

## 产品的业务方向(供取材, 别逐一画全)
${dirList}

## 画布与结构约束(让概念能被直接吸收)
- 1440×900, 浅色主题; 左侧固定深色侧边栏 196px, 顶部面包屑条, 右侧主内容区。
- 主内容区可含: 标题行、筛选/操作栏、主体(表格/表单/卡片)、可选右侧栏、底部操作条。

## 要画的原型(从下面挑 3–4 个, 用本产品的真实场景)
1. **数据监控/列表页** — 表格 + 状态徽章 + 顶部统计概览 + 筛选
2. **表单/申请页** — 表单 + 上下文摘要 + 审批流提示
3. **详情页** — 摘要头 + 多区块字段 + 右侧栏摘要
4.(可选)**排课/日历 或 仪表盘页** — 网格 / 数据卡 / 图表

## 保存位置(必须)
把每张图保存到此绝对路径目录(不存在则创建):
${conceptsDir}/
文件名: \`concept-<原型名>.png\`(如 concept-monitor-list.png / concept-form.png / concept-detail.png / concept-dashboard.png)

## 交付
保存后, 每张回一句话: 这张你想表达的视觉主张(配色 / 组件 / 层次)。`
  ].join("\n");

  return { prompt, stats };
}
