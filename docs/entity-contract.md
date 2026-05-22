# Atlas Entity Derive Contract(Path C 实体派生契约)

> 这份文档是 Atlas **派生实体(`derived/entities/<Name>.md`)** 的接口契约。
> 是产品规格层(features + SEAMS + DECISIONS + ENTITIES-OWNERSHIP)与派生 Agent 之间的契约。
> 与 [docs/flowchart-contract.md](flowchart-contract.md) 同等地位 —— 两者都是 derived layer 的契约文档。
>
> **修改本契约需要架构层级审批,不要由实现侧自行调整。**

---

## 1. 目的与作用域

### 1.1 这份契约钉的是什么

钉**派生实体产物**的形式:
- 物理位置: `data/products/<id>/derived/entities/<EntityName>.md`(一文件一实体)
- 同目录辅助文件:
  - `derived/entities/questions.md` — 派生 Agent 提的 question(模式对偶 flowchart-contract §6.3)
  - `derived/entities/reconcile-report.md` — 派生 entities vs ENTITIES-OWNERSHIP 声明的差异报告
- 派生 Agent 的输入信号 + 输出格式 + reconcile 规则 + 问题回流模式

### 1.2 这份契约不钉的是什么

- 派生 Agent 的内部算法(怎么从 4 个输入合并出实体清单)
- 实体的字段集合精确度(派生宁可标 `[TBD]` 也不要"业务常识"补)
- ENTITIES-OWNERSHIP.md 本身的形态 —— 见 [docs/entities-ownership-contract.md](entities-ownership-contract.md)

### 1.3 设计原则

1. **派生只读** — `derived/entities/` 下的任何文件 UI 不允许编辑;改源 → 重派生
2. **派生闭合** — 不能凭"业务常识"补;缺数据 → questions.md ticket 回流到 source
3. **同 contract 同入口** — 派生 Agent 与流程图 Agent 共用 questions.md trigger lint 模式
4. **永不阻塞** — 输入有任何缺失,Agent 仍能输出部分实体 + 部分 `[TBD]` 标记

---

## 2. 派生 Agent 的输入信号(从 source 读)

派生 Agent **必须**消费以下 5 类输入,任何一类缺失则该类信号视为空:

### 2.1 features(主输入)

`modules/<m>/features/<f>.md` 文件的 frontmatter:
- `entities_touched: [User, Order, ...]` — 该 feature 操作的实体规范名清单 (per feature-source-contract §3.2)
- `roles: [sales, finance, ...]`
- `ownership: org | campus | follows:<Entity> | shared`(主体实体的归属 hint)

以及 markdown body:
- `## 字段清单` 段 — 5 列表格(字段 / 类型 / 必填 / 约束 / 备注),feature-source-contract §3.3
- `## 状态转移` 段 — 4 列表格(from / to / 触发 / 角色)
- `## 字段权限` 段 — 变长列表格(字段 / role1 / role2 / ...)
- `## 描述` 段 — 自由叙述(用于推断未明示的字段 / 关系)

### 2.2 SEAMS(跨模块字段映射)

`SEAMS.md` 单文件:
- 每个接缝的"数据契约"段含字段映射(可能是 typescript-like 代码块 / 字段列表)
- 提示派生 Agent:接缝两端的 Entity 互相引用什么字段(通常体现在 `FK→<Entity>`)

### 2.3 DECISIONS(决策号引用)

`DECISIONS.md` 中的 H3 块 + 表格行:
- 实体设计意图(如 D-30 产品版本化 → 影响 Product 字段集)
- 派生实体的 `## 引用决策` 段必须列出该实体涉及的 D-id

### 2.4 ENTITIES-OWNERSHIP(归属 ground truth)

`ENTITIES-OWNERSHIP.md` 的 `## 完整归属清单` 表:
- 派生实体的 `layer` 字段直接取自此表(若实体在表中)
- 表中**有但派生没派生出来**的实体 → reconcile 报告 "声明有派生无"
- 派生**派生出但表里没声明**的实体 → reconcile 报告 "派生有声明无"

### 2.5 GLOBAL-FEEDBACK(决策者已拍板的 question)

`GLOBAL-FEEDBACK.md` 的 `## entity` 段:
- 用户对上一轮 `questions.md` 中 question 的决策(accept agent 建议 / custom 自填 / reject 驳回)
- **每条都是已解决的 question** — 本轮派生 Agent **不要**再以同样形式抛出
- 派生 Agent 把决策合入实体规格(字段必填性 / 关系建模 / 状态机分支 / 归属层 等)
- 在被影响的实体 .md 中留 `<!-- Agent note: 来自全局需求池 gfb-YYYYMMDD-xxxxxx -->` trail, 方便回溯
- 同目录 sidecar `derived/entities/questions-decisions.yml` 记录 reject 标记(见 §5.2), reject 过的 question 同样不再抛

---

## 3. 派生产物格式

### 3.1 单实体文件 `derived/entities/<EntityName>.md`

```markdown
---
name: User
layer: 机构层
maintainers: 销售 + 教务双侧
sourceFeatures:
  - sales/student-intake
  - sales/order-creation
sourceSeams:
  - 5.1
sourceDecisions:
  - D-27
  - D-30
generated_at: 2026-05-17T12:34:56Z
---

# User

派生于:
- features × N (entities_touched 含 "User")
- seams × M
- decisions × K

## 给决策者

学员的统一身份。一个学员只有一份记录,跨销售/教务共用。手机号唯一,转校时校区会变但手机号不动。
<!-- Agent note: 来自全局需求池 gfb-20260520-a3f9c2 -->

## 字段

| 字段 | 类型 | 必填 | 约束 | 备注 | 来源 |
| --- | --- | --- | --- | --- | --- |
| user_id | string | ✓ | unique, PK | | features/student-intake §字段清单 |
| phone | string | ✓ | unique | D-33 推荐人约束 | features/student-intake §字段清单 |
| campus_id | string | - | FK→Campus | [TBD] 校区由学员决定,详见 D-43 | seams/5.1 |
| ... | | | | | |

## 状态机

| from | to | 触发 | 角色 | 来源 |
| --- | --- | --- | --- | --- |
| draft | submitted | 销售点保存 | sales | features/student-intake §状态转移 |
| submitted | activated | 财务审核通过 | finance | features/order-creation §状态转移 |

## 权限矩阵

| 字段 | sales | finance | jiaowu | student |
| --- | --- | --- | --- | --- |
| phone | RW | R | R | R |
| campus_id | RW | R | R | - |
| ... | | | | |

## 引用决策

- D-27: 产品双侧职责 → 影响 User 维护权限
- D-33: 推荐人约束 → 推荐人必须是已激活学员
- D-43: 销售/合作商在机构层,学员决定校区 → User.campus_id 来自录入时选择

## 引用接缝

- 5.1 A → B: User 在销售下单时被引用(product_ids 关联)
```

### 3.2 frontmatter 字段

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `name` | ✓ | PascalCase string | 实体规范名(与文件名一致) |
| `layer` | ✓ | string | 取自 ENTITIES-OWNERSHIP.md;未声明则 `[TBD]` |
| `maintainers` | ✓ | string | 取自 ENTITIES-OWNERSHIP.md;未声明则 `[TBD]` |
| `sourceFeatures[]` | ✓ | string[] | `modulename/featureid` 列表 |
| `sourceSeams[]` | 可选 | string[] | seam id 列表(如 5.1) |
| `sourceDecisions[]` | 可选 | string[] | D-id 列表 |
| `generated_at` | ✓ | ISO string | 生成时间 |

### 3.3 body H2 段

| H2 段 | 必填 | 来源 |
|------|------|------|
| `## 给决策者` | ✓ | 派生 Agent 综合 features + ENTITIES-OWNERSHIP + DECISIONS,用 1-3 句白话写"这是什么 / 谁维护 / 关键约束"。决策者审阅视角,不写技术细节 |
| `## 字段` | ✓ | merge features 各自的 `## 字段清单` |
| `## 状态机` | 可选 | merge features 各自的 `## 状态转移`(若无 → 省略) |
| `## 权限矩阵` | 可选 | merge features 各自的 `## 字段权限`(若无 → 省略) |
| `## 引用决策` | 可选 | 列出 sourceDecisions 中 D-id 的一句话摘要 |
| `## 引用接缝` | 可选 | 列出 sourceSeams 中接缝 id + 一句话摘要 |

`## 给决策者` 段是决策者审阅闭环的入口 — 实体 tab 的 UI 会把这段抽出来高亮显示在卡片顶部,供决策者审"是不是这个东西"。**不要写技术黑话**(不写 PK/FK/索引), 业务化表述。

### 3.4 命名规范(指向 flowchart-contract §3.4 / §3.4.1 / §3.4.2)

派生实体的 `name` 字段 + 文件名 + `## 字段` 中的 FK 都必须遵守:
- §3.4 同表多名规则(不同业务名 → 同一持久化边界 → 一个规范名)
- §3.4.1 不可过度折叠规则(不同持久化边界 → 拆开)
- §3.4.2 标准命名词表(参考用)

派生 Agent 在选择 `name` 时,**优先**参照 flowchart 已有的命名(`derived/flowcharts/main.mmd` 中的 Entity 名),保证两个派生层一致。

### 3.5 [TBD] 标记

派生 Agent **拿不准时一律标 `[TBD]`** + 写 questions.md ticket。常见 [TBD]:
- 字段类型不确定
- 字段是否必填不确定
- 状态机是否完整不确定
- 角色权限不确定

### 3.6 sidecar 文件 `derived/entities/review-state.yml`(决策者审阅元数据)

派生只读约束(§1.3)指的是派生**产物**只读。决策者的审阅状态是**审阅元数据**, 不是派生产物, UI 可直接写。物理位置仍在 `derived/entities/` 但单独命名以区分:

```yaml
# data/products/<id>/derived/entities/review-state.yml
- entity: User
  reviewed_at: 2026-05-22T10:30:00Z
  reviewed_by: budalord
  note: ""
- entity: Course
  reviewed_at: 2026-05-22T11:05:00Z
  reviewed_by: budalord
  note: "字段够用,关系再确认一轮"
```

写入规则:
- UI `PATCH /derived-entities/:name/review` body `{action: "mark"|"unmark", reviewer?: string, note?: string}` → 增删条目
- 重派生时**不动** review-state.yml,但派生 Agent 应在产出新派生集后由后端清理掉对应实体已不在派生集的条目(由 GET 端点惰性清理或 PATCH 时校验)
- 文件不存在 = 无任何已审实体

立项 gate 判定: 派生 Agent 输出的全部实体都在 review-state.yml 中有 entry(reviewed_at 非空), 且 questions.md 全部 question 已决策(在 GLOBAL-FEEDBACK entity 段或 questions-decisions.yml 中 reject) → 实体审查通过, UI 解锁原型 tab。

---

## 4. reconcile 规则

派生 Agent 在产出所有 entity md 后,**必须**额外生成 `reconcile-report.md`:

### 4.1 reconcile-report.md 形态

```markdown
---
generated_at: <ISO>
---

# 派生实体 vs ENTITIES-OWNERSHIP 声明 reconcile 报告

## 派生有声明无(派生 Agent 多出来的实体)

| 实体 | 派生依据 | 建议 |
|------|----------|------|
| StudentNote | features/sales/student-intake §字段清单 提到 StudentNote | 应加入 ENTITIES-OWNERSHIP 表(B 销售层) |

## 声明有派生无(ENTITIES-OWNERSHIP 表声明但派生未生成)

| 实体 | 表声明 layer | 可能原因 |
|------|-------------|----------|
| Report | 机构层 | 无 feature 引用,纯 spec-only 实体 → 可能本就不应在派生表 |

## 归属不一致(派生 layer ≠ 表声明 layer)

| 实体 | 表声明 | 派生推断 | 建议 |
|------|--------|----------|------|
| Teacher | 校区(软隔离) | 派生显示 `<<roles: 教务老师>>` 全在本校区,无 shareable 信号 → [机构层] 还是 [校区软] 待澄清 | 走 questions.md ticket |
```

### 4.2 reconcile 规则

| 情形 | 写入 reconcile-report |
|------|----------------------|
| 派生实体 X,表中无 X | "派生有声明无" 段加行 |
| 表中实体 Y,派生无 Y | "声明有派生无" 段加行 |
| 派生实体 X.layer != 表 X.layer | "归属不一致" 段加行 |
| 实体名拼写不一致(派生 `Stud` vs 表 `Student`) | 视为不同实体,各加一行 + 在 questions.md 提示 |

### 4.3 不一致 → questions.md

每条 reconcile 差异**应**对应一条 questions.md ticket(派生 Agent 自行决定哪些足够明显跳过)。

---

## 5. questions.md 模式(对偶 flowchart-contract §6.3)

派生 Agent 不确定时,写 `derived/entities/questions.md`:

```yaml
- feature: sales/student-intake
  module: sales
  question: User 的 campus_id 是否必填?features 没明示,但接缝 5.1 暗示订单创建时需要
  trigger:
    feature_path: data/products/<id>/modules/sales/features/student-intake.md
    original_text: campus_id (由学员决定,D-43)
  proposed_resolution: 不必填(注册时为空,签单时从 student 复制)

- feature: (cross)
  module: (cross)
  question: Substitution 和 ScheduleEntry 是否同表(代课记录是否合并到课表)?
  trigger:
    feature_path: data/products/<id>/SEAMS.md
    original_text: F.create_substitution(<schedule_entry_id>, ...)
  proposed_resolution: 拆开 Substitution 独立表,见 §3.4.1 不可过度折叠
```

### 5.1 trigger lint(同 flowchart-contract §6.3.4)

每条 question 的 `trigger.original_text` 必须在 `trigger.feature_path` 文件中是**字面子串**。
- 后端 GET 端点跑 lint 失败 → UI 红条显示
- Agent 重新生成时应消除 lint 错误

trigger.feature_path 可指向:
- `data/products/<id>/modules/<m>/features/<f>.md`(标准)
- `data/products/<id>/SEAMS.md`(接缝级)
- `data/products/<id>/DECISIONS.md`(决策级)
- `data/products/<id>/ENTITIES-OWNERSHIP.md`(归属表级)

### 5.2 question 决策生命周期

决策者在 UI 上对 questions.md 中每条 question 做三选一决策, 决策落地两个地方:

| action | UI 行为 | 落地 | 下一轮派生 Agent 看到 |
|--------|---------|------|---------------------|
| `accept` | 接受 agent 的 `proposed_resolution` | 写入 `GLOBAL-FEEDBACK.md` entity 段 — 内容 = 原 question + "决策: " + proposed_resolution | 视为已解决, 合入实体规格(§2.5), 不再抛 |
| `custom` | 决策者自填决策内容 | 写入 `GLOBAL-FEEDBACK.md` entity 段 — 内容 = 原 question + "决策: " + 用户填写内容 | 视为已解决, 合入实体规格(§2.5), 不再抛 |
| `reject` | 决策者认为不是业务问题(Agent 抛错了) | 写入 sidecar `derived/entities/questions-decisions.yml` | 视为 false-positive, 不再抛同样 question; agent 应据此调整自己的 5 级自检准头 |

sidecar 形态:
```yaml
# data/products/<id>/derived/entities/questions-decisions.yml
- question_hash: <sha1 of question text>  # 同 question 跨派生轮次能对上
  status: rejected
  decided_at: 2026-05-22T11:00:00Z
  reason: "纯工程问题, 不需要业务方拍板"
```

API: `POST /derived-entities/questions/:idx/decide` body `{action: "accept"|"custom"|"reject", customContent?: string, reason?: string}`。后端复用 `POST /api/products/:id/global-feedback`(scope=entity) 的内部 helper 写入全局需求池, 不重复实现写入。

---

## 6. 不在 contract 范围(Agent 自由发挥)

- 派生算法(怎么把多个 features 的字段 merge 到一个实体)
- 字段顺序
- 来源列的格式
- 引用决策段的摘要措辞

---

## 7. API 接口

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/products/:id/derived-entities` | 派生实体清单 + `decisionMakerView`(从 `## 给决策者` 段抽出) + `reviewedAt` / `reviewedBy`(从 sidecar) + stale 状态 |
| GET | `/api/products/:id/derived-entities/reconcile` | reconcile 报告原文 + parse 后的结构化数据 |
| GET | `/api/products/:id/derived-entities/questions` | derived/entities/questions.md tickets + lint 结果 + 每条 question 的 `status`(pending / accepted / custom / rejected, 跨 GLOBAL-FEEDBACK 与 questions-decisions.yml 合并判定) |
| PATCH | `/api/products/:id/derived-entities/:name/review` | 标/取消已审; body `{action, reviewer?, note?}`; 写 sidecar `review-state.yml` |
| POST | `/api/products/:id/derived-entities/questions/:idx/decide` | 决策 question; body `{action, customContent?, reason?}`; accept/custom → 全局需求池 entity 段; reject → `questions-decisions.yml` |
| GET | `/api/products/:id/generate-prompt?scope=entity-derive` | 返回派生 prompt(由 buildEntityDerivePrompt 构造,用户复制到外部 Agent 跑) |

(注:URL 用 `/derived-entities/` 而非 `/entities/derived/`,是为了避免与 `/entities/:name` 路由冲突。物理文件仍在 `data/products/<id>/derived/entities/` 不变。)

派生产物(`<EntityName>.md` / `questions.md` / `reconcile-report.md`)仍**只读** — 改源 → 重派生。
审阅元数据(`review-state.yml` / `questions-decisions.yml`)由 UI 写, 不是派生产物。
若需要 Atlas 内嵌执行 prompt,后续可在 codexRunner 上加 scope=entity-derive 分支(与 flowchart 派生保持一致策略)。

---

## 8. UI 行为(实体 tab)

EntityTab 不再有"声明 / 派生" sub-tab — **派生即全部**, 实体 tab 仅作决策者审阅视图存在(无手写编辑入口)。

布局自上而下:
1. **立项 gate 横幅** — 全实体已审 + 0 待决策 question → 绿色 `✅ 实体审查通过, 可进原型 tab`; 否则灰色显示 `还需审 N 个实体 · 待决策 M 个 question`
2. **全局需求池 (entity scope)** — GlobalFeedbackPanel, 装新增/删除实体类的散需求 + question 决策落地后的条目
3. **questions section(一级, 不折叠)** — 每条 question 三按钮决策:
   - `✓ 接受 agent 建议` → POST decide accept(proposed_resolution 落全局需求池)
   - `✎ 自定义决策` → 弹小输入框 → POST decide custom
   - `× 驳回(不是业务问题)` → POST decide reject(只写 sidecar, 不入需求池)
   - 已决策的 question 显示淡灰 + ✓ 已落需求池 / 已驳回 标识, 等待下轮重派生消化
4. **顶部主按钮**: `📋 更新实体(读功能点 + 我的决策)` — 复用 PromptModalDialog scope=entity-derive
5. **stale 横幅**: source 文件 mtime > derived 文件 mtime → 黄条提示派生已过期
6. **reconcile 报告**: 折叠区, 三段(派生有声明无 / 声明有派生无 / 归属不一致)
7. **派生实体卡片网格**:
   - 顶部高亮 `## 给决策者` 段(emerald 色块, 业务白话)
   - 右上角 `✅ 标已审 / ↺ 取消已审` 按钮 → PATCH review
   - 卡片顶栏徽章: `🆕`(派生 7 天内未审) / `✅ 已审 ${reviewedAt}` / `💬 ${待决策 question 数}`
   - 折叠区放: 字段 / 状态机 / 权限矩阵 / 引用决策 / 引用接缝 / 来源 features/seams/decisions

派生产物只读 — UI 不允许编辑实体 .md;审阅状态(review-state.yml)与 question 决策(global-feedback / questions-decisions.yml)可写。

---

## 9. 与其他契约的关系

```
docs/entity-contract.md (本文档)
    │
    ├ 输入 ← docs/feature-source-contract.md  (features.entities_touched / 字段清单 / 状态转移 / 字段权限)
    ├ 输入 ← docs/seams-contract.md            (跨模块字段映射)
    ├ 输入 ← docs/decisions-contract.md        (决策号引用)
    ├ 输入 ← docs/entities-ownership-contract.md (ground truth 归属表)
    │
    ├ 引用 → docs/flowchart-contract.md §3.4   (命名规范)
    │
    ▼
派生产物: data/products/<id>/derived/entities/
```

派生 Agent 是 4 个 source 契约的**消费者**;不写回 source。

---

## 10. 修改流程

- 修改 §3 产物格式 / frontmatter / H2 段 → **必须**同步修改 parser + UI 卡片
- 修改 §4 reconcile 规则 → 仅改 reconciler 实现
- 修改 §5 questions trigger lint → 与 flowchart-contract §6.3.4 联动改
- 修改 §2.5 / §3.6 / §5.2(决策者审阅闭环) → 同步改 derivedEntityLoader + spec.ts 路由 + EntityTab UI + buildEntityDerivePrompt
- §1 / §6 / §7 / §8 / §9 是说明性,可独立更新

### 修改 trail

- 2026-05-22: 加 §2.5 GLOBAL-FEEDBACK entity 段输入 / §3.3 `## 给决策者` 段(必填) / §3.6 sidecar review-state.yml / §5.2 question 决策生命周期 + questions-decisions.yml sidecar / §7 PATCH+POST 接口 / §8 EntityTab UI 重做(砍 declared sub-tab, 决策者闭环, 立项 gate)。配套实现见 plan-generic-elephant.md。
