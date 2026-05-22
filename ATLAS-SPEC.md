# Atlas Markdown 规范文档

本文档定义 Atlas 立项期产品的 markdown 文件结构。所有文件必须遵守此规范，Atlas 才能正确解析和渲染。

## 目录结构

```
data/products/<product-id>/
├── meta.yml                          # 产品元信息（Atlas 自动生成）
├── STATUS.md                          # 立项期空骨架(Atlas 自动生成)
├── GLOBAL-FEEDBACK.md                 # 全局需求池(Round 3 新增,可选)
├── CONVENTIONS.md                     # L0 规范(Round 3 新增,可选)
├── DECISIONS.md                       # 产品规格层 · 决策日志(Round 4 新增,可选)
├── ARCHITECTURAL-WARNINGS.md          # 产品规格层 · 架构警告(Round 4 新增,可选)
├── SEAMS.md                           # 产品规格层 · 跨模块接缝契约(Round 4 新增,可选)
├── ENTITIES-OWNERSHIP.md              # 产品规格层 · 实体归属清单(Round 4 新增,可选)
├── EVOLUTION-PRINCIPLES.md            # 产品规格层 · 演进式设计原则(Round 4 新增,可选)
├── AI-REQUIREMENTS.md                 # 产品规格层 · AI 工作流需求(Round 4 新增,可选)
├── RISKS.md                           # 产品规格层 · 风险登记(Round 4 新增,可选)
├── modules/
│   ├── <module-id>/
│   │   ├── MODULE.md                 # 模块定义
│   │   ├── features/
│   │   │   ├── <feature-id>.md       # 功能点文件
│   │   │   └── ...
│   │   └── entities/                  # 模块内独占实体(可选)
│   │       └── <entity-id>.md
│   └── ...
└── entities/                          # 跨模块共享实体
    └── <entity-id>.md
```

## VISION.md(Layer 1,Round 4 新增,可选)

产品**愿景文件**。单文件,自由 markdown,**无强制 frontmatter**。Atlas 在概览 tab 顶部渲染完整内容(文件不存在时不渲染该卡片)。

建议 H2 结构(非强制):

```markdown
## 一句话定义
<产品定位的一句话表述>

## 商业模式回路
<可嵌 Mermaid 框图,展示主要价值流转>

## ERP 边界(做什么)
<本产品长期负责的边界 / 第三方协同 / 接入点>

## 不做什么
<明确排除的能力 / 产品边界外的事>

## 推进路线
<前期 / 中期 / 后期 / 长期 的分阶段说明>
```

**写盘约定**:用户 + Agent 协同写为主,UI 不提供写入入口(直接编辑文件)。

**与 SUMMARY.md 的关系**:VISION 是**客户视角的产品长期愿景**;SUMMARY 是 **Agent 视角的 intake 录入小结**。两者职责不重叠,可同时存在。

## meta.yml 扩展字段(Round 4 阶段 2)

为承载 v1 §0.1 关键事实表的 9 项内容,`meta.yml` 新增以下**可选**字段:

```yaml
organization: <机构名>                    # 业主机构名
business_domain: <业务领域>               # 业务领域
campuses:                                 # 多场地/校区清单(可选)
  - <场地 A>
  - <场地 B>
tech_lead: <技术负责人>                    # 技术负责人
decision_makers:                          # 决策方清单
  - <决策人 A>
  - <决策方向>
roadmap_phase: <当前推进阶段一句话>        # 当前推进阶段
doc_version: v1                            # 文档版本号
```

老产品缺失这些字段不影响加载;Atlas UI 仅在字段有值时显示对应小标签。

## 产品规格层文件(Layer 2,Round 4 新增)

围绕功能点的**产品级横切信息**。每文件单独存在,全部**可选** —— Atlas 在 UI"规格" tab 中按 3 子页签渲染:

| 文件 | 子页签 | 内容性质 | 受众 |
|------|--------|----------|------|
| `DECISIONS.md` | 决策与警告 | 决策日志(D-编号),含决策摘要 / 影响 features / 来源段 / status | 架构师 + Agent |
| `ARCHITECTURAL-WARNINGS.md` | 决策与警告 | 干系人的架构警告;含原话 / 解读 / 承接位置 / 状态 | 架构师 |
| `SEAMS.md` | 跨模块契约 | 跨模块接缝契约(8 个);含触发时机 / 数据契约 / 异常处理 | 架构师 + 派生 Agent |
| `ENTITIES-OWNERSHIP.md` | 跨模块契约 | 实体归属清单(50+ 行表);含实体 / 归属 / 维护权限 / 备注 | 架构师 + 派生 Agent |
| `EVOLUTION-PRINCIPLES.md` | 演进与风险 | 演进式设计原则(审批模式 / 作用域 / 接口预留 等) | 架构师 |
| `AI-REQUIREMENTS.md` | 演进与风险 | AI 工作流需求登记(已识别的 AI 场景表) | 架构师 |
| `RISKS.md` | 演进与风险 | 风险登记(暴雷点 / 已知开放项 / 拟处理时机) | 架构师 |

**结构化进度**(Round 4):
- **阶段 1**:全部 7 类文件 raw markdown 渲染(在 SpecTab 子页签内)
- **阶段 3**:DECISIONS.md(H3 块 + status)+ SEAMS.md(H2 章节)→ 结构化卡片;见 [docs/decisions-contract.md](docs/decisions-contract.md) / [docs/seams-contract.md](docs/seams-contract.md)
- **阶段 4**:ENTITIES-OWNERSHIP.md → 表格交互式编辑;见 [docs/entities-ownership-contract.md](docs/entities-ownership-contract.md)
- **阶段 6**:ARCHITECTURAL-WARNINGS.md → H2 块 + status 切换;见 [docs/warnings-contract.md](docs/warnings-contract.md)
- **EVOLUTION-PRINCIPLES.md / AI-REQUIREMENTS.md / RISKS.md**:保留 raw markdown 形态(快照本身是表 + 散文混合,强行结构化会破坏 — 见各 contract 关联讨论)

**L0 违规机械化检测**(阶段 6 新增):Atlas 自动检 features 是否违反命名约定 / RolesRegistry 引用 / module_group 引用 / ownership 合法值;违规列表在 L0 规范 tab 底部展示。语义级违规(描述写作风格 / 禁忌段)留派生 Agent prompt 检(后续轮次)。

**写盘约定**:文件由 Agent 写为主,UI 仅做小手术(后续阶段提供加条目表单)。文件缺失 = 空态,不阻塞产品加载。

## 命名规范

- 所有 id 必须为 kebab-case（小写 + 连字符），例如 `student-import`、`sales`
- 文件名 = id + `.md`
- id 在产品内全局唯一

## 三层架构

Atlas 立项的功能点采用**三层架构**:

```
业务方向 (module · = modules/<id>/ 目录)
└─ 管理模块 (group · MODULE.md frontmatter.groups 声明)
   └─ 功能点 (feature · features/<id>.md · 引用 module_group)
```

- **业务方向**:顶层划分,如 B 销售线 / C 财务线 / F 教务线
- **管理模块**:中层 management area,如 学员管理 / 订单管理 / 推荐管理
- **功能点**:叶子,具体动作

## MODULE.md 格式

````markdown
---
id: sales
name: B 销售线
role: 销售岗
color: red
order: 1
groups:
  - id: student-management
    name: 学员管理
    order: 1
  - id: order-management
    name: 订单管理
    order: 2
  - id: referrer-management
    name: 推荐管理
    order: 3
---

# B 销售线

## 职责
负责学员从初次接触到报名转化的全流程管理。
````

**frontmatter 字段：**

| 字段 | 必填 | 说明 |
|------|------|------|
| id | 是 | 模块唯一标识，kebab-case |
| name | 是 | 模块显示名 |
| role | 否 | 对应岗位标签（如"销售岗""教务岗"） |
| color | 否 | 视觉色，枚举值：red / blue / green / yellow / purple / indigo / gray |
| order | 否 | 模块排序，数字越小越靠前，缺省按 id 字母序 |
| groups | 强烈建议 | 管理模块(三层中层)声明,数组,每项含 `id` (kebab-case,module 内唯一) / `name` (中文) / `order` (可选) |

## 功能点文件格式

> 详细契约见 [docs/feature-source-contract.md](docs/feature-source-contract.md)。本节列出常见用法。

功能点 source 采用**三种约束承载并存**:
- **轻**:`## 描述` 段写作规范(三个粗体小标题)
- **中**:frontmatter 结构化字段(`entities_touched` / `ownership`)
- **重**:三个可选的专门段(`## 字段清单` / `## 状态转移` / `## 字段权限`)

````markdown
---
# 必填
id: student-intake
name: 学员录入
module: sales
created_at: 2026-05-17

# 三层架构中层 (强烈建议)
module_group: student-management

# 角色 (建议)
roles:
  - sales
  - partner

# 中形态:结构化提示 (建议)
entities_touched: [User, Order]
ownership: org

# 可选,Atlas 自动管理
last_refined_at: 2026-05-14
needs_revision: false
---

# 学员录入

## 描述

销售在 ERP 录入学员档案的入口流程。

**关键字段**: phone (唯一)、campus_id (由学员决定,D-43)、signer_id (当前登录销售)、referrer_student_id (仅可选已激活学员,D-33)
**关键约束**: 推荐人为非学员姓名 → 落 StudentNote,不进推荐树
**触发后续**: order-creation (订单创建流程)

## 字段清单                                ← 重形态(可选)

| 字段 | 类型 | 必填 | 约束 | 备注 |
| --- | --- | --- | --- | --- |
| phone | string | ✓ | unique | |
| campus_id | string | ✓ | FK→Campus | D-43 |
| signer_id | string | ✓ | FK→User | |
| referrer_student_id | string | - | FK→User · only activated | D-33 |

## 状态转移                                ← 重形态(可选)

| from | to | 触发 | 角色 |
| --- | --- | --- | --- |
| draft | submitted | 销售点保存 | sales |
| submitted | activated | 财务审核通过 | finance |

## 字段权限                                ← 重形态(可选)

| 字段 | sales | finance | jiaowu | student |
| --- | --- | --- | --- | --- |
| phone | RW | R | R | R |
| campus_id | RW | R | R | - |
| signer_id | RW | R | - | - |

## 线索池
### Pending
- (2026-05-14) 希望支持 Excel 批量导入

### Resolved
- (2026-05-13) 录入后要自动分配给值班销售

## 反馈池

```yaml
[]
```
````

**frontmatter 字段：**

| 字段 | 必填 | 说明 |
|------|------|------|
| id | 是 | 功能点唯一标识，kebab-case |
| name | 是 | 功能点显示名 |
| module | 是 | 所属业务方向 id，必须与 modules/ 下某个目录名一致 |
| created_at | 是 | 创建日期，ISO 格式 |
| module_group | 强烈建议 | 管理模块 id (三层架构中层),引用 MODULE.md frontmatter.groups[].id |
| roles | 建议 | 参与该 feature 的角色 id 列表 (来自 data/roles.yml) |
| entities_touched | 建议 | 该 feature 操作的实体规范名清单 (PascalCase) |
| ownership | 建议 | 主体实体归属层: `org` / `campus` / `follows:<Entity>` / `shared` |
| last_refined_at | 否 | 最后一次 agent 处理时间，Atlas 自动维护 |
| needs_revision | 否 | 反馈池非空时由 Atlas 自动写 `true`；revise Agent 处理完后由 Agent 自己删除 |

**section 规范：**

- `## 描述`(必填):功能点叙述,**建议含 `**关键字段**:` / `**关键约束**:` / `**触发后续**:` 三个粗体小标题**(轻形态)
- `## 字段清单`(可选,重形态):5 列表格 `字段 | 类型 | 必填 | 约束 | 备注`
- `## 状态转移`(可选,重形态):4 列表格 `from | to | 触发 | 角色`,有状态机的 feature 才写
- `## 字段权限`(可选,重形态):变长列表格,头行 `字段 | <role1> | <role2> | ...`,单元格 `RW` / `R` / `-`
- `## 线索池`(可选):下分 `### Pending` / `### Resolved` 子段,每条格式 `- (YYYY-MM-DD) 内容`
- `## 反馈池`(Round 3):yaml 代码块,字段 `id / date / content`,id 形如 `fb-<YYYYMMDD>-<6位 base36>`。空池写 `[]`
- `## 修订记录`(Round 3):Agent revise 后追加,每条 `- YYYY-MM-DD: 简短说明`

线索池和反馈池可以是空段（只有标题），Atlas 仍然解析为空数组。重形态三段全部可选,缺则 parser 返回 undefined,UI 不渲染对应区。

## 反馈池机制（Round 3）

- 用户在 Atlas UI 上对一个 feature/entity 加一条反馈 → 后端 POST 写入 `## 反馈池` yaml 块并**自动给 frontmatter 加** `needs_revision: true`。
- 用户删除反馈 → 删完后反馈池为空时,后端**自动从 frontmatter 抹掉** `needs_revision`。
- markmap 节点上标 ⚠ 表示该 feature 有 needs_revision 或反馈池非空。
- revise Agent 处理完后**必须**清理痕迹:删除 needs_revision、清空 `## 反馈池`、在 `## 修订记录` 追加一行。

## GLOBAL-FEEDBACK.md（Round 3 新增）

装"新增/删除一个 feature 或 module"这类无法挂在已有对象上的反馈。

````markdown
---
last_updated: 2026-05-15
---

# 全局需求池

## 功能点需求

```yaml
- id: gfb-20260515-x9y8z7
  date: 2026-05-15
  scope: feature
  content: 建议新增「档案导出」功能
```

## 实体需求

```yaml
[]
```

## 原型需求

```yaml
[]
```
````

字段约定：

- 三段（`## 功能点需求` / `## 实体需求` / `## 原型需求`）独立解析；任一段 yaml 损坏不影响其他段。
- yaml 条目字段：`id` (gfb-前缀)、`date`、`scope` (feature/entity/prototype)、`content`。
- 没有 `needs_revision` 标签 — 文件有内容即待办。
- 处理完后 Agent **不要直接改 GLOBAL-FEEDBACK.md**，告诉用户哪几条 gfb 应该删除，由用户在 UI 删。

## CONVENTIONS.md（Round 3 新增，L0 规范）

装产品级硬约束。Agent 在 L1（实体）/ L2（功能点）操作时必须遵循。

````markdown
---
spec_level: 0
version: 1
last_updated: 2026-05-15
---

# <产品名> · L0 规范

## 命名约定
- 字段名: snake_case
- 实体 id: PascalCase

## 字段约定
- 所有实体必含 `created_at` / `status`

## 通用流程
- 订单生成时锁定 service_version_id / pricing_version_id

## 一致性要求
- 同 product_id 下两组字段必须同步维护版本号

## 禁忌
- 不允许物理删除业务表记录

## 决策快照
- D-26 全功能自助端
````

机制：

- L0 是"全集快照"，有变化时通过 generate prompt 重跑比逐条修订更自然。
- spec_level=0 / version 自增 / last_updated 这三个 frontmatter 字段是建议结构，Atlas 不强校验。
- 暂无 conventions scope 的反馈池（设计决策，见 ROUND-4-TODO 第 4 条）。

## 单文件汇总导入格式

用户在初始化阶段会跟 Codex 头脑风暴产出一份汇总 md 文件，Atlas 提供导入入口，解析后拆分到上述目录结构。

汇总文件格式：

````markdown
---
product_id: example-erp
product_name: 示例 ERP
---

# 示例 ERP

## 产品概述
一个示例 ERP 产品,用于演示 Atlas 汇总 md 导入格式。

---

## 模块: 销售模块
- id: sales
- role: 销售岗
- color: red
- order: 1

### 职责
负责线索从初次接触到转化的全流程管理。

### 功能点

#### 线索录入
- id: lead-import

描述：销售从各渠道获取线索信息后，录入到系统形成线索池。

#### 跟进记录
- id: follow-up

描述：销售对线索池中的客户进行电话/微信跟进，记录每次沟通要点。

---

## 模块: 运营模块
- id: ops
- role: 运营岗
- color: blue
- order: 2

### 职责
...

### 功能点
...
````

**解析规则：**

- 文档级 frontmatter 提供 product_id 和 product_name
- 每个 `## 模块:` 二级标题开启一个模块定义
- 模块块内的 `- id: xxx` 列表项提取 frontmatter 字段
- `### 职责` 段写入 MODULE.md 的"## 职责"
- `### 功能点` 段下的每个 `#### xxx` 开启一个功能点
- 功能点的 `描述：xxx` 行写入功能点文件的"## 描述"
- 功能点导入时自动生成空的"## 线索池"段（Pending + Resolved 都为空）

**已有内容导入说明（重要）：**

用户的 ERP 设计已有一定规模。规范文档应支持用户**手动整理现有内容**到此格式，不要求强制流程。用户的实际操作是：

1. 拿这份 ATLAS-SPEC.md 给 Codex
2. 让 Codex 协助把现有 ERP 内容（散落在各处）按此格式整理成单个汇总 md
3. 通过 Atlas 导入入口拖入

Atlas 不负责"从零头脑风暴"或"内容增强"，只负责"按规范解析"。

## ProductStatus 说明

立项期产品 status = `planning`（上一轮已加），导入后保持 planning。
