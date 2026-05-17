# Atlas 功能点 Source 契约

> 这份文档是 Atlas **功能点 (`features/<f>.md`)** 这一类 source-of-truth 文件的形式契约,
> 是写 Agent (生成/修订 feature.md 的) 和 派生 Agent (流程图、实体派生等) 之间的接口规范。
>
> **修改本契约需要架构层级审批,不要由实现侧自行调整。**

---

## 1. 目的与作用域

### 1.1 这份契约钉的是什么

钉 **feature.md 文件的结构形态**:

- frontmatter 的字段集合(必填/选填,类型,语义)
- markdown body 的段结构(哪些 H2 段是契约规范段、哪些是自由段)
- 段内的子结构(表格列、列表格式、转移规则等)

### 1.2 这份契约不钉的是什么

- 派生层 (flowchart / entity) 的产物格式 —— 各有各的契约
- 描述里的具体文字风格 (留给写 Agent 自由发挥)
- module / group 划分原则 —— 由 Atlas 三层架构 (业务方向 / 管理模块 / 功能点) 设计原则约束

### 1.3 设计原则 (不可妥协)

1. **三种约束承载并存**: 轻 (描述写作规范) + 中 (frontmatter 结构化字段) + 重 (可选专门段)
2. **重形态全部可选**: 简单 feature 可省略;复杂 feature 按需补
3. **Agent-friendly 容错**: 缺段 / 格式坏 → parser 返回 undefined,不阻塞
4. **派生覆盖率取决于 source 信号密度**: 写得越规范,派生越准

---

## 2. feature.md 完整形态

```yaml
---
# ─── 必填 frontmatter ──────────────────
id: <kebab-case>                          # feature id,在 module 内唯一
name: <显示名>                            # 中文显示名
module: <moduleId>                        # 业务方向 (= modules/ 下目录名)
created_at: YYYY-MM-DD

# ─── 三层架构中层 (强烈建议填) ─────────
module_group: <groupId>                   # 管理模块 id,引用 MODULE.md 的 groups[].id

# ─── 角色 (建议填) ─────────────────────
roles:                                    # 参与该 feature 的角色 id 列表
  - <roleId>
  - ...

# ─── 中形态:结构化提示 (建议填) ────────
entities_touched:                         # 该 feature 操作的实体规范名清单
  - <EntityName>
  - ...
ownership: <org | campus | follows:Entity | shared>
                                          # 该 feature 主体实体的归属层

# ─── 可选 frontmatter (parser 已支持) ──
needs_revision: false                     # Agent 自动管理
spec_level: 0                             # 规范层级(默认 0)
last_refined_at: null                     # Agent 上次 refine 时间
added_in_phase: live                      # 在哪个 phase 被追加 (planning/in-progress/live)
added_at: YYYY-MM-DD
---

# <name>

## 描述                                   # 必填,轻形态承载

<自由叙述,但建议含三个粗体小标题>

**关键字段**: <字段1 (约束)、字段2 (约束)...>
**关键约束**: <跨实体不变式 / 唯一性 / 权限边界...>
**触发后续**: <调用的下游 feature / 触发的事件...>

## 字段清单                               # 重形态,可选

| 字段 | 类型 | 必填 | 约束 | 备注 |
| --- | --- | --- | --- | --- |
| <name> | <type> | <✓/-> | <unique/FK→Entity/enum/...> | <text> |
| ... | ... | ... | ... | ... |

## 状态转移                               # 重形态,可选 (有状态机的 feature 才写)

| from | to | 触发 | 角色 |
| --- | --- | --- | --- |
| <state> | <state> | <动作描述> | <roleId> |
| ... | ... | ... | ... |

## 字段权限                               # 重形态,可选 (字段级权限差异显著时才写)

| 字段 | <role1> | <role2> | <role3> | ... |
| --- | --- | --- | --- | --- |
| <field> | RW | R | - | ... |
| ... | ... | ... | ... | ... |

## 线索池                                 # 已有段,Atlas 自动管理

### Pending
- (YYYY-MM-DD) <线索内容>

### Resolved
- (YYYY-MM-DD) <线索内容>

## 反馈池                                 # 已有段,Atlas 自动管理

```yaml
[]
```
```

---

## 3. 字段语义详解

### 3.1 三层架构定位字段

- `module` — **业务方向** (sales / finance / academic-affairs ...)。对应物理目录 `modules/<module>/`
- `module_group` — **管理模块** (student-management / order-management ...)。引用 `MODULE.md` frontmatter.groups[].id
  - 缺省 → markmap 显示为"未分组"
  - 引用 MODULE.md 未声明的 group → UI 显示 `<id> ⚠`,parser 仍透传

### 3.2 中形态字段

#### `entities_touched: string[]`

该 feature 操作的实体规范名列表 (per flowchart-contract §3.4)。例:
```yaml
entities_touched: [User, Order, Payment]
```

派生 Agent 用途:
- **流程图生成 Agent**: 作为 Entity 规范名映射的种子,降低命名歧义
- **实体派生 Agent (Path C)**: 直接获得该 feature 触及的实体清单,无需从 description 自然语言提取

写作要求:
- 用 PascalCase 规范名 (不要写"学员",写 `User`)
- 与 flowchart-contract §3.4 规范名映射保持一致
- 不确定的实体不写 (留给 description 提示),避免误导派生

#### `ownership: string`

该 feature 主体实体的归属层。合法值:

| 值 | 语义 | 示例 |
|----|------|------|
| `org` | 机构层 (跨校区共享) | `Product` / `Major` / `CommissionRule` |
| `campus` | 校区层 (硬隔离 / 软隔离 by 字段) | `Class` / `Schedule` / `Classroom` |
| `follows:<Entity>` | 归属跟随另一实体 | `follows:Order` (Payment / Refund 跟订单) |
| `shared` | 跨产品共享 (走 contracts/) | `User` (与 legacy-id 账号体系共用) |

不填 → 未声明,派生侧标 `[TBD]`。

派生 Agent 用途:
- **实体派生 Agent**: 直接落地为 entity md 的 `## 归属` 段
- **schema 设计后续步骤**: 决定是否加 `campus_id` 字段、是否按校区分库

### 3.3 重形态段

三段全部 **可选**,parser 容错。

#### `## 字段清单`

5 列固定表格: `字段 | 类型 | 必填 | 约束 | 备注`

- `字段`: snake_case
- `类型`: TypeScript 原始类型名 (`string` / `number` / `boolean` / `Date` / `<Enum>` / `<Entity>[]`)
- `必填`: `✓` 或 `-`
- `约束`: 自由描述。常用:`unique` / `FK→Entity` / `enum: a|b|c` / `regex: ^...$` / `default: 0`
- `备注`: 自由描述。常引用决策 (`D-43`) 或交叉引用

#### `## 状态转移`

4 列固定表格: `from | to | 触发 | 角色`

- 描述该 feature 主体实体的状态机
- 状态名 snake_case (`draft` / `submitted` / `approved` ...)
- 触发列描述动作 / 事件
- 角色列引用 RolesRegistry id

#### `## 字段权限`

变长列表格: `字段 | <role1> | <role2> | ...`

- 头行后从 role 列开始,使用 RolesRegistry id 作列名
- 单元格值: `RW` (读写) / `R` (只读) / `-` (无权限)
- 与 flowchart 的 entity-level scope 互补 —— 这里到字段级

---

## 4. Parser 容错规则

| 情形 | 处理 |
|------|------|
| frontmatter 缺 `roles` 字段 | 等价空数组 |
| frontmatter `entities_touched` 非数组 | 视作未声明,undefined |
| frontmatter `ownership` 非字符串 / 非合法值 | 视作未声明,undefined (不报错) |
| `## 字段清单` 段缺失 | undefined |
| `## 字段清单` 表格列数不对 / 列顺序错 | 跳过整段,undefined,日志 warning |
| `## 状态转移` 段缺失 / 格式错 | undefined |
| `## 字段权限` 段缺失 / 列名非 RolesRegistry id | undefined |

**永不阻塞 feature 加载** —— 主 frontmatter (id/name/module/created_at) 正常即视作有效 feature。

---

## 5. 派生 Agent 应当如何消费

### 5.1 流程图生成 Agent (现状)

只消费:
- `roles[]` → 节点的 `<<roles: ...>>`
- `description` → 推断业务流转顺序

可选消费 (本契约新增,流程图侧暂未集成):
- `entities_touched` → Entity 规范名映射的种子,降低 §3.4 命名歧义

### 5.2 实体派生 Agent (Path C, 待落地)

消费:
- `entities_touched` → 该 feature 触及的实体清单
- `ownership` → entity md 的归属段
- `## 字段清单` → entity md 的 `## 字段` 段
- `## 状态转移` → entity md 的 `## 状态机` 段 / 状态字段约束
- `## 字段权限` → entity md 的字段级权限矩阵

写作要求:
- 缺失的维度填 `[TBD]`,**不要靠业务常识补**
- 同实体被多个 feature `entities_touched` 引用时,**合并字段清单**;字段冲突时走 questions.md

### 5.3 派生 Agent 的统一规则

- 不写回 feature.md (单源原则)
- 拿不准走 questions.md (per flowchart-contract §6.3.4 的 trigger lint 模式)
- 缺数据宁可标 [TBD] / 留空,不要补

---

## 6. 写 Agent 应当如何产 feature.md

### 6.1 生成时机

由 Atlas `buildFeatureGeneratePrompt` 触发 (feature-gen prompt 在 UI 上的 "生成功能点骨架" 按钮)。

### 6.2 强制项

必填 frontmatter 字段 (§2 列出的"必填"区) 必须有,否则 parser 当作非法 feature 跳过。

### 6.3 强建议项 (Agent 应主动写)

- `module_group` —— 三层架构中层归属。Agent 应在生成计划阶段先规划 MODULE.md 的 groups,再让所有 feature 引用之
- `roles[]` —— 至少一个角色
- `entities_touched` —— 至少一个 Entity
- `ownership` —— 4 个合法值之一,真不确定时省略

### 6.4 可选项 (复杂 feature 才写)

- `## 字段清单`: 当 feature 主体实体有 3+ 关键字段时写
- `## 状态转移`: 当主体实体有 2+ 状态时写
- `## 字段权限`: 当字段级权限在不同 role 间显著差异时写

简单 feature (如 "学员自助端" 这种纯入口、"招生看板" 这种纯聚合视图) 三段全部省略。

### 6.5 写作风格规范

`## 描述` 段建议含三个粗体小标题作骨架:
- `**关键字段**:` —— 列 3-5 个核心字段 + 约束(每个一句话)
- `**关键约束**:` —— 跨实体不变式 / 唯一性 / 权限边界 / 引用决策
- `**触发后续**:` —— 调用的下游 feature id / 触发的事件

例:
```markdown
## 描述

销售在 ERP 录入学员档案的入口流程。

**关键字段**: phone (唯一)、campus_id (由学员决定,D-43)、signer_id (当前登录销售/合作商)、referrer_student_id (仅可选已激活学员,D-33)
**关键约束**: 推荐人为非学员姓名 → 落 StudentNote,不进推荐树
**触发后续**: order-creation (订单创建流程)
```

---

## 7. 与其他契约的关系

```
docs/feature-source-contract.md (本文档)
    │
    │ 约束 → modules/<m>/features/<f>.md 的写法
    │ 约束 → modules/<m>/MODULE.md 的 groups[] 声明
    │ 约束 → 聚合 md (Tab 1 录入) 的 feature 区段格式
    │
    ▼
派生 Agent 接口契约:
    ├─ docs/flowchart-contract.md (流程图派生)
    └─ docs/entity-contract.md (实体派生 · 待写,Path C 落地时)
```

- 修改本契约可能需要同步修改 ATLAS-SPEC.md (user-facing format spec)
- 修改本契约不影响 flowchart-contract / entity-contract,除非新增/删除 frontmatter 字段会改变派生 Agent 的输入信号

---

## 8. 修改流程

- 修改 §2-§3 frontmatter / 段格式 → **必须**同步修改 parser + prompt builder + UI 展示
- 修改 §4 容错规则 → 不影响 source 文件,只改 parser
- 修改 §6 写作规范 → 只改 prompt builder
- §1, §5, §7, §8 是说明性,可独立更新
