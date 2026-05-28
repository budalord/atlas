import path from "node:path";
import type { GlobalFeedbackScope, ProductMeta } from "@atlas/shared";
import { DATA_ROOT, readTextFile } from "./fileReader";
import { normalizeProductMeta, parseYaml } from "./markdownParser";
import { loadEntities, loadModules, loadFeatures } from "./entityLoader";
import { loadUseCases } from "./usecaseLoader";
import { loadScreens } from "./screenLoader";
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

export interface UseCasePromptStats {
  usecases_with_revision: number;
  global_count: number;
}

export interface ScreenPromptStats {
  screens_with_revision: number;
  global_count: number;
}

export type ReviseStats =
  | FeaturePromptStats
  | EntityPromptStats
  | PrototypePromptStats
  | UseCasePromptStats
  | ScreenPromptStats;

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

/**
 * Agent 自决原则 — 所有 Atlas prompt 共享。
 *
 * 真实问题反馈(用户原话): "一些 agent 能决定的, 为啥非要我来给方案? 假设你不知道预设多少时间,
 * 你建议 30 天那就先三十天, 如果是流程方面的需要我确认, 那才需要提问题让我审核。"
 *
 * 防止 agent 把任何犹豫都包装成"决策者请审", 打断业务方判断节奏。
 */
export const AGENT_SELF_DECISION_PRINCIPLE = `### Agent 自决原则(强约束 · 所有 Atlas Agent 必读)

**核心**: 决策者只拍业务流程 / 业务规则 / 业务约束 / 架构归属。 其他全部 agent 自决。

**5 级自检 — 抛问题前必过**:
1. 上下文里有答案吗?(features / SEAMS / DECISIONS / ENTITIES-OWNERSHIP / CONVENTIONS / GLOBAL-FEEDBACK 已决条目) → 有 = 自决, 复用
2. grep / 文件名模式 / 已有 .md 历史能查到吗? → 能查 = 自决
3. 默认值能跑吗?(操作类参数: 时长 / 上限 / 频率 / 超时 / 数量) → 能 = 选合理默认值, **不抛**
4. 工程决策吗?(字段类型 string/enum / FK 方向 / 索引 / 命名 / 关系建模 / 状态机一边/字段权限矩阵单格) → 是 = 自决, 加 \`<!-- Agent note: 理由 -->\` 留痕
5. 业务问题吗?(谁有权 / 何时触发 / 业务规则 / 业务约束 / 业务关系 / 架构边界) → 真业务 = 抛 question

**判别金句**:
> 不写代码光开会能说清楚的 = 业务问题, 必须看 schema 才能定的 = 工程问题。
> 能写出 proposed_resolution 的 = 已自决, 直接执行, **不抛**。

**默认值清单**(操作类参数, agent 直接选, 不抛):
- 时长不知道 → 30 天
- 列表分页不知道 → 20 条/页
- 文件大小上限不知道 → 50 MB
- 重试次数不知道 → 3 次
- 超时不知道 → 30 秒
- 提醒频率不知道 → 每天 1 次
- 历史保留期不知道 → 法务相关 7 年 / 其他 1 年
- 字符串字段长度不知道 → 短文本 64 / 中文本 255 / 长文本 4000

写入字段约束的备注列或 entity .md 的 \`<!-- Agent note -->\` 标"agent 选了 X, 业务方否决可改"。

**❌ 反例**(以下都是 agent 自决就行, 不抛):
- "X 字段是 string 还是 enum?" — 工程, 看 features 字段清单自决
- "FK 双向还是单向?" — 工程, 默认单向 + 加 note
- "状态机要不要加 cancelled 状态?" — 看 features 状态转移段 / 默认加宽容状态
- "单文件大小上限多少?" — 默认 50 MB
- "提醒频率每天几次?" — 默认 1 次
- "重试几次?" — 默认 3 次
- "X 实体加不加到归属表?" — agent 元工作, 不抛
- "推荐人改名后字段类型用 string 还是 ref?" — 工程

**✅ 正例**(真业务, 该抛):
- "销售提交退费申请后, 财务还没审之前, 销售能不能撤回?" — 业务流程
- "Lead 是 ERP 自己存还是只在第三方 CRM?" — 架构边界
- "教师工资记录在 ERP 内还是飞书报销中?" — 数据归属边界
- "套餐摊价按权益条数还是原价比例?" — 影响提成业务规则
- "推荐人改名后, 历史关系字段保持原值还是更新?" — 业务规则(历史可追溯 vs 当前一致性)

**抛 question 的格式要求**(若决定抛):
- 必须写出 \`proposed_resolution\` (你建议的答案 + 理由)
- 必须能答出"为什么 features / 上下文 里没解 / 不该在那里解"
- 写不出 proposed_resolution → 说明你没消化够上下文, **回去读**, 不要抛
`;

/**
 * 决策者视角写作规范 — 在所有"## 给决策者" 段(feature / usecase 都用此规范)的 prompt 里复用。
 * 注: 实体 .md 在 rev3 后已废弃 ## 给决策者 段(纯 schema), 本规范只用于 feature / usecase。
 *
 * 真实问题反馈(用户原话): "给决策者的话要再大白话一点, 不然我不知道是哪张表, 是哪个关系,
 * 学长他也看不懂不能决策。 出来的给决策者文案好多都是 agent 视角的东西"。
 */
export const DECISION_MAKER_VIEW_GUIDE = `### \`## 给决策者\` 段写作规范(强约束 · agent 必读)

**读者是非技术业务决策方**(学长 / 校长 / 投资人), 他们要 30 秒读懂 + 看出"该不该这么做" + 知道"哪里要拍板"。

**写作格式**(必须三段, 每段 1-3 行白话):

\`\`\`
**做什么**:<业务故事一句话 — 谁在做什么 → 触发什么后续>

**取舍**:<关键业务规则 1-3 条, 用业务语言, 不说技术实现>

**待你拍**:
- [ ] <决策点 1, 业务方能答得上来的事 — 范围 / 上限 / 启用与否 / 时间>
- [ ] <决策点 2>
\`\`\`

**\`**待你拍**\` 填法 — 严格过 AGENT_SELF_DECISION_PRINCIPLE 的 5 级自检**:
- 默认值能跑的(时长 / 上限 / 频率) → 选默认值, **不写到待你拍**
- 工程决策(类型 / 关系建模 / 命名) → agent 自决, **不写到待你拍**
- 上下文有答案的 → 复用, **不写到待你拍**
- 写不出 → 删掉, 不灌水
- 真业务规则 / 流程 / 权限 / 边界 → 写。 每条 ≤ 30 字, 业务方能答 yes/no 或选项 A/B

**每个 feature \`待你拍\` 硬上限 3 条**, 超过 = 你没消化清楚, 重过 5 级自检。

**❌ 严禁出现的术语**(出现就重写):
- **数据术语**: entity / 实体 / 表 / 子表 / 主键 / 外键 / FK / PK / unique / 索引 / 关联表 / 快照 / 字典硬绑
- **schema 名字**: 所有 PascalCase 实体名(Student / Order / Product / Lead 等) / 所有 snake_case 字段名(signer_id / referrer_student_id / cohort_year / lost_reason 等)
- **派生术语**: derived / 衍生 / 派生字段 / "x 自动算的标签"
- **契约编号**: D-43 / SEAMS 5.5 / 接缝 5.2 — 改为白话规则描述

**✅ 推荐用的词**:
- **业务对象**: 学员 / 销售 / 订单 / 课程 / 老师 / 校区 / 班级 / 教务 / 财务 / 推荐人 / 合作商
- **业务动作**: 录入 / 审核 / 通过 / 拒绝 / 报名 / 签单 / 上课 / 退费 / 排课 / 触达
- **业务关系**: 推荐人 / 签单销售 / 同届学员 / 上级 / 同期 / 跨校区
- **业务约束**: 必填 / 不能改 / 自动算出来 / 必须从内置清单选 / 仅 X 类型学员才有

**写完自查金句**:
> 把这段念给完全不懂技术的业务领导, 他能 30 秒理解 + 能识别"这事该不该这么做"吗?
> 不能 → 重写, 直到通过这个测试。

**对比示例**:
\`\`\`
❌ 不及格: "订单Line 子表 + 推荐人放 订单 + 一旦 审核通过 不可改金额"
✅ 合格: "一个订单可以买多个产品(套餐); 推荐人按每单单独记录(同一学员不同订单可以来自不同推荐人); 一旦审核通过, 金额锁死不可改"

❌ 不及格: "FK→JuniorCollege 字典硬绑, exam_cohort 必填"
✅ 合格: "大专院校 / 专业从内部预置清单选, 不能自由填; 必须指定考试届(如 2026 届), 后续学号、订单、学情都跟这个届数走"

❌ 不及格: "学员从付款建档开始,跟踪到上岸/落榜/失联/退费的全周期状态"
✅ 合格: "学员从付钱报名建档开始, ERP 一路跟到 上岸 / 落榜 / 联系不上 / 退费, 每个阶段状态都自动转, 决策者能一眼看出全公司学员各阶段比例"
\`\`\`
`;

const FEATURE_TASK = `## 你的任务
你是 Atlas 的 Function 修订 Agent (v0.1 rev3 五层骨架: Actor / Capability / Function / UseCase / Entity)。
根据下面的反馈, 修订对应的 function (feature.md) 文件 + 必要时拆 UseCase + 维护 Capability 归属。

${AGENT_SELF_DECISION_PRINCIPLE}

${DECISION_MAKER_VIEW_GUIDE}

工作流要求:
1. 先阅读完所有反馈和上下文, 在响应里输出一份 diff plan
2. **等用户确认后再实际写文件**(用 Edit/Write 工具)
3. 写完每个 function 文件后:
   - 把 frontmatter 的 needs_revision 删除(或改为 false)
   - **必须有 \`capability_id\`** 字段(v0.1 必填), 引用 capabilities/<id>.md 中存在的 capability
   - 优先用新字段 \`actor_ids\` (v0.1 rename from roles), 旧 \`roles\` 字段可同时保留
   - **如果反馈影响了功能点的语义边界 / 关键取舍 / 决策者需要拍的事**, 同步更新 \`## 给决策者\` 段, **严格按上方《决策者视角写作规范》** — 三段格式 + 不出现 schema 黑话 + 写完自查金句过一遍。 该段缺失则新建在 \`## 描述\` 之前
   - **如果你改了 \`## 给决策者\` 内容, 顺便把 frontmatter 的 \`reviewed_at\` / \`reviewed_by\` 字段删掉**(决策者视角变了 = 需要重新审阅)
   - 把 ## 反馈池 段清空为 \`[]\`
   - 在 ## 修订记录 段追加一行: "{today}: 基于 N 条反馈修订 - 简短说明"
4. **何时拆 UseCase** (按 docs/usecase-contract.md §3 规则 7):
   - **拆**: 同动作不同 actor 发起 / 同动作不同前置条件(不同业务路径) / 同动作但数据流向 / 外部系统不同
   - **不拆**: 仅字段差异 / 仅 UI 入口差异 / 仅状态机一条边差异
   - 拆 UseCase 时: 新建文件 \`modules/<m>/usecases/<scenario>.md\` (文件名仅用 scenario 关键词, 不带 function_id 前缀)
   - UseCase frontmatter 必须有 \`id / function_id / actor_id\`
   - UseCase 主流程 / 备选流程在 body 的 \`## 主流程\` / \`## 备选流程\` H2 段中
5. **何时新建 Function**:
   - **必须先扫**同 capability 下 entities_touched ≥ 70% 重合 / name 相似度高的 function
   - 找到 → 在 diff plan 里写明合并或区分理由
   - 没说明 → 不允许新建。 默认行为是合并到已有 function (并入字段权限/状态分支/UseCase)
   - 新建时 capability_id 必填, 不允许"无归属" function (规则 6a)
6. **何时新建 Capability**:
   - 如果反馈描述的 function 不属于任何已有 capability, 才新建 capability
   - 新 capability frontmatter 必须有 \`id / name / domain / value_statement / actor_ids / entity_ids / priority / status: draft\`
   - domain 从预定义池选: 招生 / 教务 / 财务 / 人事 / 数据集成 / 决策与报表(规则 2)
   - 一个 capability 下 function 数 3-10 为健康 (规则 8)
7. 全局需求池条目处理完后, **直接编辑 GLOBAL-FEEDBACK.md** 清理:
   - 在对应 yaml 块里删除已处理 gfb 条目
   - 保留未处理 / 暂不采纳的条目
   - 更新 frontmatter \`last_updated\` 为今天
   - 三段结构保持不变, 空段写 \`[]\`
`;

const ENTITY_TASK = `## 你的任务
你是 Atlas 的实体修订 Agent。根据下面的反馈,修订对应的 entity md 文件。

${AGENT_SELF_DECISION_PRINCIPLE}

## ⚠ 实体 .md 是纯 schema (rev3 决策者反馈定型)

entity .md body 只允许以下段(按出现顺序): \`## 字段\` + (可选) \`## 状态机\` + (可选) \`## 权限\` + (可选) \`## 引用决策\` + (可选) \`## 引用接缝\`。

**严禁出现**: \`## 给决策者\` / "做什么 / 取舍 / 待你拍" / 业务故事段。 决策点全部走 questions.md, 不进 entity .md。

判别金句: 实体 .md 应该读起来像 SQL DDL 注释, 不像产品文档。

## 工作流

1. **先输出 diff plan** — 改哪些 entity / 应用哪些 gfb 决策 / 自决了哪些工程问题 / 真业务问题准备抛(应该 ≤ 3 条)
2. **等用户确认后再实际写文件**
3. 清理 \`needs_revision\` + 清空反馈池 + 追加修订记录(同 feature 修订)
4. 全局需求池条目处理完后, **直接编辑 GLOBAL-FEEDBACK.md**:
   - \`## 实体需求\` yaml 块里删除已合入的 gfb 条目
   - 不采纳的在 diff plan 说明理由并删除
   - 更新 frontmatter \`last_updated\`, 三段结构保持(空段写 \`[]\`)
`;

const FEATURE_FOOTER = (productId: string) => `## 注意事项
- 不要触碰 data/products/${productId}/ 之外的文件
- 不要修改 STATUS.md / SUMMARY.md / 补充 .md
- 每个 feature.md 改完后,运行 atlas 应能正常加载(不要破坏 frontmatter 结构)
- 如果反馈让你做"新增 feature"的事,在新位置 data/products/${productId}/modules/{moduleId}/features/{newId}.md 创建文件
  * frontmatter 必须包含 id, name, module, created_at
  * 新文件 needs_revision 不要写(新建即基线,无需修订)

## ⚠ 新建 feature 前必读 · 去重检查

立项阶段一个产品常出现"同一动作被多个 feature 描述"导致实体派生时噪音。新建 feature 前 **必须** 先扫:

1. **同 module 下 entities_touched 重合 ≥ 70%** 的现存 feature
   - 例: 新 feature 触及 [Refund, Order, Payment], 已有 \`refund-application\` 触及 [Refund, Order, Payment, User] → 重合 75%, **可能是同一件事的不同切面**
2. **同 module 下 name 相似度高** 的 feature
   - 同动词(退费 / 退款 / 退订) / 同实体名(学员 / 订单) / 子串包含
3. **同 module_group 下的兄弟节点**(管理模块级别本来就该高内聚)

扫到候选 → 在 diff plan 里**明确说**:
- "我把 X 合并到已有的 Y, 因为 ... " (描述合并理由 + 把新 feature 的反馈内容并入 Y 的字段权限 / 状态分支 / 字段清单), 或
- "我新建 X, 因为它跟 Y 在 actor / 状态机 / 字段权限上有本质区别 — 具体: ... " (描述区分点)

**没写说明 → 不允许新建。** 默认行为是合并到已有 feature。
`;

const ENTITY_FOOTER = (productId: string) => `## 注意事项
- 不要触碰 data/products/${productId}/ 之外的文件
- 不要修改 STATUS.md / SUMMARY.md / 补充 .md
- entity.md 的 ## 字段 / ## 关系 / ## 决策 段结构是 parser 依赖的,改完后保持表头与列数一致
- 如果反馈让你做"新增 entity"的事,顶层共享实体放 entities/<id>.md,模块实体放 modules/<m>/entities/<id>.md
`;

const ACTOR_TASK = `## 你的任务
你是 Atlas 的 Actor 修订 Agent (v0.1 rev3 五层骨架)。根据下面的反馈, 修订对应的 actor md 文件。

${AGENT_SELF_DECISION_PRINCIPLE}

工作流要求:
1. 先阅读所有反馈, 在响应里输出 diff plan(打算改哪些 actor / 合并哪些 / 新增哪些 / 理由)
2. **等用户确认后**再用 Edit/Write 写文件
3. 写完每个 actor.md 后:
   - frontmatter 字段顺序保留 actor-contract §2 规定的 id / name / type / source / confirmed (+ 可选 code / responsibilities)
   - **绝对不写**反向引用字段 (related_capability_ids / related_function_ids 等) — 这些 loader 运行时聚合, 写进 .md 会破坏单源原则
   - body 部分: 业务描述自由叙述, 决策者视角
4. **何时新建 Actor**:
   - 反馈描述了一个目前没在 actor 池中的角色 → 新建
   - 新 actor.md frontmatter 必须有 id / name / type / source: 'agent_suggested' / confirmed: false
   - 默认 type 推断规则: 内部员工 → internal_user; 客户/家长/合作商 → external_user; 平台/集成方 → external_system
5. **何时合并 Actor**:
   - 发现池中有两个 actor 实际是同一角色(eg. "教务" + "academic-staff" 是同一概念) → 合并
   - 合并方法: 保留更通用的 id, 把另一个的 responsibilities 合并过来, **同时改所有 capability/function/usecase 引用**
   - 删除时直接 \`fs.unlink actors/<old_id>.md\`
6. 全局需求池条目处理完后, 直接编辑 GLOBAL-FEEDBACK.md 清理已处理 gfb 条目, 三段结构保持
`;

const ACTOR_FOOTER = (productId: string) => `## 注意事项
- 不要触碰 data/products/${productId}/ 之外的文件
- actor.md 改完, capability / function / usecase 引用必须同步更新, 否则 l0 规则 6 会报警
- 反向引用永不写入 .md frontmatter(单源原则)
- 改 actor.type 要小心: 影响 ActorTab 卡片分组 + MatrixTab 颜色编码
`;

/**
 * UseCase Revise — 把 usecase body 信息密度拉满, 为下游 Screen / Entity 推导提供输入。
 *
 * 故意不引 DECISION_MAKER_VIEW_GUIDE: usecase body 是技术性叙述(步骤 / 字段 / 状态), 没有 "## 给决策者" 段,
 * 引入决策者视角规范会让 agent 把字段名也按 "禁 schema 黑话" 重写, 反而破坏 usecase 技术准确性。
 */
const USECASE_TASK = `## 你的任务
你是 Atlas 的 UseCase 修订 Agent。根据下面的反馈, 重写对应的 usecase body, 把信息密度拉满, 让下游 Screen / Entity 推导有足够输入。

${AGENT_SELF_DECISION_PRINCIPLE}

## 工作流

1. **先输出 diff plan** — 改哪些 usecase / 应用哪些反馈 / 是否触发拆分建议 / 自决了哪些工程问题
2. **等用户确认后**再用 Edit/Write 改 .md
3. 对每个 usecase, 用 Read 工具阅读以下上下文(prompt 不内联, 节省 token):
   - \`modules/<m>/usecases/<id>.md\` 当前完整内容
   - frontmatter.function_id 指向的 \`modules/<m>/features/<fn>.md\`(理解功能上下文)
   - frontmatter.actor_id 指向的 \`actors/<actor>.md\`
   - frontmatter.entity_ids 逐一打开 \`derived/entities/<name>.md\` 的 \`## 字段\` markdown 表
4. 按下方《Body 重写规范》重写 body
5. 改完后:
   - 把 \`## 反馈池\` 段重置为空(\`\`\`yaml\\n[]\\n\`\`\`)
   - 删除 frontmatter 的 \`needs_revision\` 字段(若反馈被清空, feedbackWriter 会自动清, 但 agent 主动清更稳)
   - 在 body 末尾的 \`## 修订记录\` 段(没有则新建)追加: "{today}: 基于 N 条反馈修订 - 简短说明"

## Body 重写规范(4 段, 缺一不可)

### Section A · 步骤序列

6 列 markdown 表, 目标 8 步, 超过 12 步触发拆分建议(见下方):

\`\`\`
| 步骤名 | 触发条件 | actor 动作 | 系统响应 | 字段读写 | 状态变化 |
|---|---|---|---|---|---|
| 填表 | actor 进入录入页 | 录入姓名/电话/渠道 | 实时校验手机号格式 | Student.name(W), Student.phone(W), Student.channel(W) | (无) |
| 提交 | 点提交 | — | 校验通过则落库 | Student.* (W) | Student: 待创建 → 已建档 |
\`\`\`

- **字段读写**: \`{EntityName}.{field}(R|W|D)\` — R 读 / W 写 / D 派生。 字段名**必须**来自 entity 字段表, 不发明
- **状态变化**: 优先引 entity \`## 状态机\` 段定义的状态名; 若 entity 未定义状态机, 允许自然语言状态描述(如 "档案已入库"), **禁发明** schema 级状态枚举名(如 \`StudentStatus.ACTIVE\`)
- 步骤扁平不嵌套, 不写实现细节(表名 / API 路由 / ORM / 索引)

### Section B · 异常分支

2~5 个异常。 格式:

- **异常名**: 触发条件 / 系统响应 / 用户感知

### Section C · 次要 actor 可见性

本 usecase 中除主 actor 之外哪些 actor **在 UI 上能看到主流程的哪些步骤**(UI 可见层级, 不下沉到字段)。 **字段级权限属于 feature 范围**(feature.字段权限矩阵已管), 不在此处展开。 格式:

- **{actor_name}**: 可见步骤 [步骤名 1, 步骤名 2, ...] / 不可见步骤 [...]

若无次要 actor, 写 "(无)"。

### Section D · Revision Log

一行, 简述本次改了什么。

## 拆分建议机制(避免反馈池自循环)

若发现某 usecase 实际违反 \`docs/usecase-contract.md §3\` 拆分规则(步骤超 12 / 跨多个流程目标 / 跨多个主导 entity):

- **不写入反馈池**(避免下次 revise 当成普通反馈再处理, 形成死循环)
- **改为在 frontmatter 写入或更新 \`split_suggestion: "..."\` 字段**(单行字符串, 说明应拆为哪几个 usecase + 简短理由)
- body 重写仍完成 Section A(主流程), B/C/D 可标 "待拆分后补"
- UseCaseModal 会在 UI 上 banner 提示用户做拆分决策

**状态机分支处理**:主流程的状态机分支(撤回 withdrawn / 取消 cancelled / 驳回 rejected 等)**默认作为异常分支(Section B)**, 除非该分支自身的主流程步骤 ≥ 5 步才考虑拆为独立 usecase。

## 强约束

- frontmatter **仅允许写入或更新 \`split_suggestion\` 字段 + 清除 \`needs_revision\` 字段**, 其他 frontmatter 字段一律不动(id / function_id / actor_id / entity_ids / precondition / postcondition / source)
- **entity_ids 处理**: 若 entity_ids 中某 entity 在 Section A 完全无字段读写, 保留 entity_ids 不动(frontmatter 不改), 在 Revision Log 中追加一句 "X entity 本次 revise 后无字段使用, 是否窄化 entity_ids 由用户审阅时决定"
- 字段名必须来自 entity 字段表
- 状态名软约束(见 Section A)
- **Agent note 用法**: 工程决策 / 默认值选择 / 业务自决留痕 → 用 \`<!-- Agent note: 理由 + "业务方否决可改" -->\` 行内 HTML 注释, 可放表格任一 cell 内 / 异常分支末尾 / 任何需要留痕的位置
- **revise 期间不许把同一类反馈再丢回反馈池**(自循环死锁): 反馈中的业务模糊点优先按 AGENT_SELF_DECISION_PRINCIPLE 5 级自检自决 + Agent note 留痕; 真自决不动再写 \`split_suggestion\` 让人决策。 **反馈池 revise 完后只能为空 \`[]\`, 不许往里追加新反馈**
- 不写实现细节
- 步骤扁平
`;

const USECASE_FOOTER = (productId: string) => `## 注意事项
- 不要触碰 data/products/${productId}/ 之外的文件
- 不要修改 STATUS.md / SUMMARY.md / 补充 .md
- usecase.md 改完, 运行 atlas 应能正常加载(parser 依赖 frontmatter 的 id / function_id / actor_id 三必填字段)
- 反向引用永不写入 frontmatter(单源原则)
- \`## 反馈池\` 段是 parser + feedbackWriter 依赖的, 必须保留 H2 标题(空池写 \`[]\`)
`;

/**
 * Screen Revise — 类比 UseCase, batched 模式, 沿 USECASE_TASK 同结构。
 */
const SCREEN_TASK = `## 你的任务
你是 Atlas 的 Screen 修订 Agent (v0.1 双轨设计 · 界面轨)。根据反馈, 重写对应 screen 的 body / entity_visibility, 确保字段引用闭环、状态变体齐全。

${AGENT_SELF_DECISION_PRINCIPLE}

## 工作流

1. **先输出 diff plan** — 改哪些 screen / 应用哪些反馈 / 是否触发 entity_visibility 调整
2. **等用户确认后**再 Edit/Write
3. 对每个 screen, 读盘获取上下文:
   - \`modules/<m>/screens/<id>.md\` 当前完整内容
   - frontmatter.usecase_ids 中每个 usecase 的 \`modules/<m>/usecases/<u>.md\`
   - 涉及的每个 entity 的 \`derived/entities/<EntityName>.md\` 字段表
4. 重写 body 时保留 7 段结构(用途 / 拆分理由 / 信息架构 / 字段可见性补充说明 / 状态变体 / 设计决策 / 反馈池)
5. 改完后:
   - 反馈池重置为 \`[]\`
   - 删除 frontmatter.needs_revision
   - body 末尾 \`## 修订记录\` 段(没有则新建)追加: "{today}: 基于 N 条反馈修订 - 简短说明"

## 强约束

- 字段名必须来自 entity 字段表; \`derived_fields\` 中的字段必须在表中标 derived
- \`entity_visibility.<E>.default\` 必须覆盖该 entity 被本 screen 承接的 usecase 中写入(W)的字段
- 不写 Figma 链接 / CSS / 颜色值
- frontmatter 仅允许更新 \`entity_visibility / usecase_ids / prototype_url / preview_image\` + 清除 \`needs_revision\`, 不动 \`id / module\`
- **Agent note 用法**: 工程决策 / 默认值选择 / 业务自决留痕 → 用 \`<!-- Agent note: 理由 + "业务方否决可改" -->\` 行内 HTML 注释, 可放任何 body 段落内
- **revise 期间不许把同一类反馈再丢回反馈池**(自循环死锁): 反馈中的模糊点优先按 AGENT_SELF_DECISION_PRINCIPLE 5 级自检自决 + Agent note 留痕; 真自决不动再写 \`split_suggestion\` 让人决策
- 若反馈涉及"该屏其实应该拆为多屏", 写 \`split_suggestion: "..."\` 字段, 由人决策, 不自行新建多个 screen 文件
`;

const SCREEN_FOOTER = (productId: string) => `## 注意事项
- 不要触碰 data/products/${productId}/ 之外的文件
- screen.md 改完, 运行 atlas 应能通过 validateScreen(\`POST /api/products/${productId}/screens\` 校验)
- 反向引用永不写入 frontmatter(单源原则)
- \`## 反馈池\` 段是 parser + feedbackWriter 依赖的, 必须保留 H2 标题(空池写 \`[]\`)
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

function usecaseBlock(
  moduleId: string,
  functionId: string,
  usecaseId: string,
  feedbackLines: string[],
  splitSuggestion?: string
): string {
  const splitLine = splitSuggestion
    ? [`⚠️ 已有 split_suggestion: ${splitSuggestion}`, ""]
    : [];
  return [
    `### modules/${moduleId}/usecases/${usecaseId}.md (function: ${functionId})`,
    ...splitLine,
    `反馈条目(${feedbackLines.length} 条):`,
    ...feedbackLines,
    ""
  ].join("\n");
}

function screenBlock(
  moduleId: string,
  screenId: string,
  screenName: string,
  feedbackLines: string[]
): string {
  return [
    `### modules/${moduleId}/screens/${screenId}.md (${screenName})`,
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

/**
 * UseCase Revise prompt — batched 模式, 扫所有 needs_revision=true 或反馈池非空的 usecase 一次出 prompt。
 * 全局需求池没有 usecase scope (历史上 usecase 工作折叠在 feature scope 里), 这里不引全局段。
 */
export async function buildUseCaseRevisePrompt(productId: string): Promise<ReviseResult> {
  const meta = await loadMeta(productId);
  const usecases = await loadUseCases(productId);
  const blocks: string[] = [];
  let usecasesWithRevision = 0;

  for (const u of usecases) {
    const fbs = u.feedback ?? [];
    if (!u.needs_revision && fbs.length === 0) continue;
    usecasesWithRevision += 1;
    const fbLines = fbs.length === 0
      ? ["(frontmatter 标了 needs_revision 但反馈池已空,请确认是否仍需修订)"]
      : fbs.map((fb) => `- [${fb.id}] (${fb.date}) ${fb.content.replace(/\n/g, " ")}`);
    blocks.push(usecaseBlock(u.module, u.function_id, u.id, fbLines, u.split_suggestion));
  }

  const parts: string[] = [
    header(meta, productId, "用例"),
    USECASE_TASK,
    "## 待处理的 usecase 反馈",
    "",
    blocks.length === 0 ? "(没有 needs_revision=true 的 usecase)\n" : blocks.join("---\n"),
    USECASE_FOOTER(productId)
  ];

  return {
    prompt: parts.join("\n"),
    stats: {
      usecases_with_revision: usecasesWithRevision,
      global_count: 0
    }
  };
}

/**
 * Screen Revise prompt — batched, 扫所有 needs_revision=true 或反馈池非空的 screen。
 */
export async function buildScreenRevisePrompt(productId: string): Promise<ReviseResult> {
  const meta = await loadMeta(productId);
  const screens = await loadScreens(productId);
  const blocks: string[] = [];
  let screensWithRevision = 0;

  for (const s of screens) {
    const fbs = s.feedback ?? [];
    if (!s.needs_revision && fbs.length === 0) continue;
    screensWithRevision += 1;
    const fbLines = fbs.length === 0
      ? ["(frontmatter 标了 needs_revision 但反馈池已空,请确认是否仍需修订)"]
      : fbs.map((fb) => `- [${fb.id}] (${fb.date}) ${fb.content.replace(/\n/g, " ")}`);
    blocks.push(screenBlock(s.module, s.id, s.name, fbLines));
  }

  const parts: string[] = [
    header(meta, productId, "界面屏"),
    SCREEN_TASK,
    "## 待处理的 screen 反馈",
    "",
    blocks.length === 0 ? "(没有 needs_revision=true 的 screen)\n" : blocks.join("---\n"),
    SCREEN_FOOTER(productId)
  ];

  return {
    prompt: parts.join("\n"),
    stats: {
      screens_with_revision: screensWithRevision,
      global_count: 0
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

/**
 * Actor 修订 prompt (v0.1 rev3). 用于 Wizard 中 Agent 反问 / 主工作台 Actor revise。
 *
 * 输入:
 *   - 当前 actors/ 中的 actor 列表(基本信息 + 反向引用计数)
 *   - 全局需求池 entity 段(Wizard 阶段没专门的 actor scope, 复用 entity 段以承载 actor 决策)
 * 输出: agent 阅读后给出 diff plan
 */
export async function buildActorRevisePrompt(productId: string): Promise<ReviseResult> {
  const meta = await loadMeta(productId);
  const global = await parseGlobalFeedbackFile(productId);

  const text = [
    header(meta, productId, "Actor"),
    ACTOR_TASK,
    "",
    "## 当前 actors 池",
    "(由 Atlas 启动时聚合, 不要直接写反向引用)",
    "",
    globalSection("entity", global.entity), // 复用 entity 段作 Actor 决策容器(Actor 没专门 scope)
    "",
    ACTOR_FOOTER(productId)
  ].join("\n");

  return {
    prompt: text,
    stats: { global_count: global.entity.length }
  };
}
