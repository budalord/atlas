# Atlas UseCase 契约

> 这份文档是 Atlas **UseCase (`modules/<m>/usecases/<scenario>.md`)** 这一类 source-of-truth 文件的形式契约。
> UseCase 描述具体业务场景, 是 Function 的可选子层 — 同一 function 在不同 actor / 前置条件 / 数据流向下的具体走法。
>
> **修改本契约需要架构层级审批, 不要由实现侧自行调整。**

---

## 1. 目的与作用域

### 1.1 这份契约钉的是什么

- 物理位置: `data/products/<id>/modules/<module>/usecases/<scenario_id>.md` (按 module 分桶, 与 features/ 平级)
- frontmatter 必填 / 引用规则
- body 主流程 / 备选流程 / 备注 H2 结构
- 文件命名规范 (规则 7)

### 1.2 这份契约不钉的是什么

- UseCase 之间的依赖关系 (没有 usecase → usecase 直接引用; 用 function.触发后续 + state machine 表达)
- UseCase 与 Entity 的精确字段映射 (那是 function 的 ## 字段权限段的职责)
- 派生层 (流程图 / 实体派生) 如何使用 UseCase

### 1.3 设计原则

1. **可空** — 简单 function 可以不挂任何 usecase。UseCase 是按需补的, 复杂场景才拆。
2. **真源单向写** — UseCase 存 `function_id` / `actor_id` (真源), function 和 actor 不存 "我有哪些 usecase" 反向引用, loader 运行时聚合 (规则 4)
3. **拆分有规则** — 规则 7 (见 §3) 明确什么时候拆, 什么时候不拆。 反推 / Wizard 时 agent 必须按此规则
4. **文件名极简** — 只用场景关键词, 不带 function_id 前缀 (规则 7)

---

## 2. modules/<m>/usecases/<scenario>.md 完整形态

```yaml
---
# ─── 必填 frontmatter ──────────────────
id: douyin-channel                    # kebab-case, 与文件名一致, function 内唯一
function_id: student-intake           # 真源, 引用 function.id (裸 id, 不带 module 前缀, 规则 1)
actor_id: partner                     # 真源, 主参与者 (单数, usecase 必须有明确的主 actor)

# ─── 选填 frontmatter ──────────────────
entity_ids:                           # 可选, 默认继承 function.entities_touched
  - Student
  - IntakeText
precondition: 抖音渠道线索已转给合作商
postcondition: 学员档案落库 + 学号生成 + 触发首单
source: user_input                    # user_input | agent_suggested | inferred_from_function_name

# ─── 不允许出现的字段 ────────────────────
# ❌ related_function_ids   (单向: usecase → function)
# ❌ secondary_actor_ids    (UseCase 只有 1 个主 actor, 其他角色在主流程步骤里说明)
---

# <name>

## 主流程
1. <步骤 1>
2. <步骤 2>
...

## 备选流程
- 条件 A → 走 ...
- 条件 B → 走 ...

## 备注
<自由叙述, 如数据流向特殊点 / 外部系统集成方式 / 异常处理>
```

### 2.1 必填字段说明

| 字段 | 类型 | 约束 |
|------|------|------|
| `id` | string | kebab-case, 与文件名一致, function 内唯一 |
| `function_id` | string | 必须引用存在的 function.id (裸 id, 不带前缀, 规则 1) |
| `actor_id` | string | 必须引用存在的 actor.id; 单数 |

### 2.2 选填字段说明

| 字段 | 默认 | 说明 |
|------|------|------|
| `entity_ids` | 继承 function.entities_touched | 可窄化(只列该 usecase 实际操作的实体) |
| `precondition` | 空 | 触发该 usecase 的前置业务条件 |
| `postcondition` | 空 | usecase 完成后的业务状态 |

---

## 3. 拆分规则 (规则 7 落地)

### 3.1 应当拆分的情形 ✅

| 情形 | 例子 |
|------|------|
| 同动作不同 actor 发起 | "换方向" 销售提抄送 vs 教务发起 → 拆 2 个 usecase |
| 同动作不同前置条件 (业务路径不同) | "学员录入" 抖音渠道 vs 线下渠道 → 拆 2 个 usecase |
| 同动作但数据流向 / 外部系统不同 | "退费" 走微信原路退 vs 走对公转账 → 拆 2 个 usecase |

### 3.2 不应当拆分的情形 ❌

| 情形 | 说明 |
|------|------|
| 仅字段差异 | "学员录入" 必填字段在不同方案下略有差别 → 用 function.字段权限 表达, 不拆 usecase |
| 仅 UI 入口差异 | 同样的 "退费申请" 在销售工作台 vs 财务后台都能发起 → 用 function.actor_ids 多列表达, 不拆 usecase |
| 仅状态机一条边差异 | "订单提交" 在 draft → submitted vs draft → cancelled → 用 function.状态转移 段表达, 不拆 usecase |

### 3.3 边界判断公式

> 如果一个 usecase 跟另一个 usecase 的**主流程步骤超过 2 步不同**, 或**precondition 不同导致进入路径完全不同**, 或**postcondition 涉及完全不同的下游系统** → 拆。 否则合并到 function.<相应段> 表达。

---

## 4. 命名规范

- **文件名**: 只用场景关键词 (eg. `douyin-channel.md`), **不**带 function_id 前缀 (~~`student-intake-douyin.md`~~ 错)
- `id`: kebab-case, **与文件名一致**
- `name` (H1 标题): 中文短句, 描述场景 (eg. "抖音渠道合作商学员录入" / "销售发起的同大类换方向")
- function_id 在 frontmatter 是唯一真源, 不在文件名重复 (规则 7)

---

## 5. API 接口

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/products/:id/usecases` | 列出全部 usecase (跨 module) |
| GET | `/api/products/:id/usecases/:functionId/:usecaseId` | 单个 |
| POST | `/api/products/:id/usecases` | 创建 (body 含 module + function_id + scenario id) |
| PATCH | `/api/products/:id/usecases/:functionId/:usecaseId` | 改 |
| DELETE | `/api/products/:id/usecases/:functionId/:usecaseId` | 删 |

POST 校验:
- `function_id` 必须引用存在的 function
- `actor_id` 必须在 product actors 池
- usecase id 在 function 内不重复

---

## 6. 非功能性约束

- **无缓存** (规则 5)
- **反向引用运行时聚合** (规则 4): `FunctionWithRefs.usecase_ids` 通过扫所有 usecase.md 反查
- **UseCase 可空**: 一个 function 没有 usecase 是合法的(简单 function 不需要)

---

## 7. 与其他契约的关系

```
usecase-contract.md (本文档)
    │
    ├─ 引用 → docs/feature-source-contract.md  (usecase.function_id 引用 function.id)
    ├─ 引用 → docs/actor-contract.md           (usecase.actor_id 引用 actor.id)
    ├─ 引用 → docs/entity-contract.md          (usecase.entity_ids 引用 Entity 规范名)
    │
    └─ 被引用 ← docs/flowchart-contract.md     (流程图派生可用 usecase 增强场景节点)
```

---

## 8. 修改流程

- 改 §2 frontmatter → 必须同步改 parser + UseCaseModal UI
- 改 §3 拆分规则 → 必须同步改 revisePromptBuilder.USECASE_TASK 文案 + 反推 prompt
- §4 / §5 / §7 是说明性, 可独立更新

### 修改 trail

- 2026-05-23: 初稿 v0.1 (rev3 五层骨架重构, 见 plan-generic-elephant.md)
