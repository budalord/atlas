<!-- MIRROR target: .claude/skills/alts/SKILL.md. Canonical: AGENTS.md. 两份文件正文必须语义等价;若不一致,以 AGENTS.md 为准。修改任意一份时同步另一份。 -->

# Atlas Agent Instructions

Atlas/alts is an agent-native, local-first product specification system. These instructions apply when maintaining Atlas product specs, Intake outputs, `STATUS.md`, `meta.yml`, feature rows, or cross-product contracts. They do not apply to general application coding.

## Read First

Before making changes, read the smallest set of source-of-truth files needed for the task:

- Start with `README.md` and `docs/DATA-MODEL.md`.
- Before modifying a product, read `data/products/<id>/meta.yml` and `data/products/<id>/STATUS.md`.
- When shared APIs or cross-product dependencies are involved, read relevant files under `data/contracts/`.
- When parser behavior matters, treat `apps/api/src/services/markdownParser.ts` / `featureParser.ts` / `entityParser.ts` / `feedbackParser.ts` / `globalFeedbackParser.ts` as the implementation source of truth. If documentation and code disagree, code wins.

## Schema Rules

- `STATUS.md` must keep the expected structure with all six sections in this order:
  1. frontmatter (with at least `last_updated`)
  2. `# 当前状态`
  3. `## 待办`
  4. `## 阻塞`
  5. `## 功能点`
  6. `## 流程图`
- The feature table under `## 功能点` must have exactly 6 columns: `ID | 描述 | 状态 | 优先级 | 接口 | 备注`.
- Do not use 4-column tables, omit columns, reorder columns, or add columns. The parser maps cells positionally, so malformed tables silently shift data into the wrong fields.
- Feature IDs must be sequential within a product. The prefix can be product-specific (e.g. `F1`, `FE01`), but it must stay consistent within the same product.
- Priority uses `P0/P1/P2/P3`.
- For uncertain facts, write `TODO`, `待确认`, or an explicit note. Do not invent business facts.
- `meta.yml` field values follow `docs/DATA-MODEL.md`. `status` is one of `discovering / planning / in-progress / paused / live / archived`; `theme` is one of `seo / erp / miniapp / tool`.
- `meta.yml` has no `intake_substage` field. (Round 3 removed it — three-stage planning UI was deleted in favor of the markmap + feedback-pool flow.)

## Module / Feature / Entity Tree (Round 3)

Once a product passes Intake (Discover/Interview/Finalize) and starts decomposing, content lives in a tree:

```
data/products/<id>/
  meta.yml
  STATUS.md
  GLOBAL-FEEDBACK.md         (optional, 见下方"全局需求池")
  CONVENTIONS.md             (optional, L0 规范,见下方)
  modules/
    <moduleId>/
      MODULE.md              (optional)
      features/
        <featureId>.md
      entities/              (optional, 模块内独占实体)
        <entityId>.md
  entities/                  (optional, 跨模块共享实体)
    <entityId>.md
```

老产品仅有 STATUS.md 6 列表、没有 modules/entities 树。Atlas UI 对这类产品的功能点 tab 显示占位提示,不报错。

### feature.md 结构(Round 3)

```markdown
---
id: student-intake
name: 学员录入
module: sales
created_at: 2026-05-15
needs_revision: true             # optional, 反馈池非空时由 Atlas 自动写
---

# 学员录入

## 描述
…

## 线索池
### Pending
- (2026-05-15) 用户手输的便签
### Resolved
- (2026-05-13) 已被 codex refine 消化的线索

## 反馈池
```yaml
- id: fb-20260515-a1b2c3
  date: 2026-05-15
  content: 建议把推荐人字段限制为已激活学员
```

## 修订记录
- 2026-05-15: 基于 2 条反馈修订描述 — 拆分子页签
- 2026-05-12: 初次创建
```

- `## 线索池` 与 `## 反馈池` 是**两个不同概念**:线索池是用户手输便签 + Codex refine 消化;反馈池是 Agent 提案 / 用户对该 feature 的"我希望改成 X"留言。
- `## 修订记录` 仅由 revise Agent 写;Atlas 只读不写。

### entity.md 结构(Round 3)

```markdown
---
added_in_phase: planning
added_at: 2026-05-15
needs_revision: false            # optional
---

# Student 学员

## 字段
| 字段名 | 类型 | 必填 | 约束 | 备注 |
| --- | --- | --- | --- | --- |
| student_id | String | yes | 唯一 | 业务主键 |

## 关系
- N:1 → Class (class)

## 决策
- **D-01 标题**: 理由

## 反馈池
```yaml
[]
```

## 修订记录
- 2026-05-15: 初次创建
```

- entity 的 `## 决策` 段和字段表里的 `[TBD]` 标记继续解析(`entityParser.ts`);Round 3 删除了它们的聚合 tab,但**数据层保留**,未来恢复聚合视图无需迁移数据。

## 反馈池(对象级)

每个 feature.md / entity.md 末尾的 `## 反馈池` yaml 块。

字段(精简后只剩 3 个):
```yaml
- id: fb-<YYYYMMDD>-<6位 base36>
  date: YYYY-MM-DD
  content: |
    多行正文
```

机制:
- Atlas UI 上"加反馈"→ POST 时**自动写** frontmatter `needs_revision: true`。
- Atlas UI 上"删反馈"→ 删完后反馈池为空时**自动抹掉** `needs_revision`。
- markmap 节点标 ⚠ 代表该 feature 的 `needs_revision=true` 或反馈池非空。

Agent 的处理义务(收到 revise prompt 后):
1. 读取该 feature 的反馈池每一条。
2. 修订 feature.md 文件主体(描述 / 字段 / 关系等)。
3. **必须**:把 frontmatter 的 `needs_revision` 删除(或改为 false)。
4. **必须**:把 `## 反馈池` 段清空为 `[]`。
5. **必须**:在 `## 修订记录` 段追加一行 `YYYY-MM-DD: 基于 N 条反馈修订 - 简短说明`(没有该段就自己新建)。
6. 不采纳的反馈也要在 diff plan 里说明理由,**仍然清理**(否则下次 revise 会重复处理)。

## 全局需求池

文件: `data/products/<id>/GLOBAL-FEEDBACK.md`,装"新增/删除一个 feature 或 module"这类无法挂在已有对象上的反馈。

文件结构:
```markdown
---
last_updated: 2026-05-15
---

# 全局需求池

## 功能点需求
```yaml
- id: gfb-<YYYYMMDD>-<6位 base36>
  date: 2026-05-15
  scope: feature
  content: 建议新增「学员档案导出」功能
```

## 实体需求
```yaml
[]
```

## 原型需求
```yaml
[]
```
```

机制:
- 三段(scope=feature/entity/prototype)**独立解析**,任一段 yaml 损坏不影响其他段。
- 没有 `needs_revision` 标签 — 有内容即待办。
- Atlas UI 的 feature/entity/design tab 顶部各有一个全局需求池折叠面板,只显示对应 scope 的条目。
- revise prompt 自动把"对象级反馈"(needs_revision=true 的 feature/entity)和"全局需求池条目"一并拼进 prompt。

Agent 处理义务:全局需求池条目处理完后,**直接编辑 GLOBAL-FEEDBACK.md** 删除对应的 yaml 条目(整段 `- id: gfb-xxx ... content: ...` 都删),更新 frontmatter 的 `last_updated` 为今天,保持三段结构(空段写 `[]`)。不采纳的条目也要在 diff plan 里说明理由,**仍然删除**(否则下次 revise 会重复处理)。

> 说明:之前的版本(Round 3 早期)要求 Agent 把"应删 id"告诉用户,由用户在 Atlas UI 手动删。实测发现用户经常忽略提示导致全局需求池积累垃圾,5' 补丁改为 Agent 直接清理。

## L0 规范(CONVENTIONS.md)

文件: `data/products/<id>/CONVENTIONS.md`,装产品级硬约束(Agent 在 L1=实体 / L2=功能点 操作时必须遵循的基线)。

文件结构:
```markdown
---
spec_level: 0
version: 1
last_updated: 2026-05-15
---

# <产品名> · L0 规范

## 命名约定
- 字段名: snake_case
- 实体 id: PascalCase
- 模块目录: kebab-case

## 字段约定
- 所有实体必含 `created_at` / `status`
- 软下架统一 `status: archived`

## 通用流程
- 订单生成时锁定 service_version_id / pricing_version_id

## 一致性要求
- 同 product_id 下两组字段必须同步维护版本号

## 禁忌
- 不允许物理删除业务表记录
- 不允许跨校区共享 Schedule

## 决策快照
- D-26 全功能自助端
- D-27 双侧维护
```

机制:
- L0 是"全集快照",有变化时通过 generate prompt **重跑**比逐条修订更自然。
- Round 3 没有 conventions scope 的反馈池,也没有 revise prompt(只走 generate)。
- spec_level=0 / version 自增 / last_updated 这三个 frontmatter 字段是建议结构,Atlas 不强校验。

## Revise / Generate Prompt 两种模式

Atlas 通过 `/api/products/:id/revise-prompt?scope=...` 和 `/api/products/:id/generate-prompt?scope=...` 暴露两种工作模式给 Agent。

| 模式 | 输入 | 输出文件 | 触发条件 |
| --- | --- | --- | --- |
| **revise**(增量修订) | needs_revision=true 的 feature/entity 反馈池 + 全局需求池 | 修订已存在的文件 | 用户点底部「📋 复制全局 revise prompt」按钮 |
| **generate**(从零生成) | 产品 description + 已有 features/entities 摘要(仅作上下文) | 新建文件 / 重跑覆盖 | 用户点顶部「📋 生成 X 骨架」按钮(只在空态显示) |

Agent 收到 prompt 时通过**标题**识别模式:
- "# Atlas {阶段}修订任务" → revise 模式,产出 diff 改现有文件,完成后清理痕迹(见反馈池义务)
- "# Atlas {阶段}生成任务" → generate 模式,先输出生成计划等用户确认,再写新文件;新文件**不要**写 needs_revision(新建即基线)

两种模式互不冲突。同一 feature 可以在 revise 模式下被修订,也可以在 generate 模式下被新建。

## Intake Stage Mapping

Use the public Chinese/English stage names in user-facing docs and UI text. Use internal stage values only when working with API/types.

| Public stage | Internal values |
| --- | --- |
| 发现 (Discover) | `stage1` |
| 访谈 (Interview) | `stage2`, `stage2-pending` |
| 沉淀 (Finalize) | `stage3`, `finalized`, `done` |

The type source of truth is `packages/shared/src/types.ts`.

## Workflows

### New Product Intake

- Follow the three-stage Intake flow: 发现 (Discover), 访谈 (Interview), 沉淀 (Finalize).
- Discover inspects the source project read-only and produces factual observations (`DISCOVERY.md`) without modifying source project code.
- Interview asks only business/product questions that cannot be answered from code, captured in `INTERVIEW.md`, and waits for the user to answer.
- Finalize must leave these artifacts in place under `data/products/<id>/`: `STATUS.md` (full 6-section structure with the 6-column feature table and a Mermaid 流程图), an updated `meta.yml`, and `SUMMARY.md` (recording which fields were inferred from code, which were taken from user answers, and which remain uncertain).
- If the user confirms shared APIs, shared databases, or shared account systems, create contract drafts under `data/contracts/<provider>-<consumer>-<topic>.md`.
- Keep `DISCOVERY.md` and `INTERVIEW.md` as history; do not delete them.

### Product Status Maintenance

- Use this workflow for status updates, feature completion, feature additions, and `meta.yml` maintenance. Feature completion is part of this workflow, not a separate one.
- Make the smallest necessary edits to `data/products/<id>/STATUS.md` and, when needed, `meta.yml`.
- Preserve the `STATUS.md` section layout and the 6-column feature table schema. New rows must use the same 6 columns; priority uses `P0/P1/P2/P3`.
- Keep todos, blockers, summary text, and feature statuses aligned with the requested change.
- Update the `last_updated` field in `STATUS.md` frontmatter.

### Feedback Revise

- Use this workflow when invoked via a revise prompt copied from Atlas UI.
- Read all feedback (object-level `## 反馈池` and global `GLOBAL-FEEDBACK.md` entries with matching scope).
- Output a diff plan in the response, **wait for user confirmation**, then write files.
- For every file touched: clear `needs_revision`, empty its `## 反馈池` to `[]`, append a line to `## 修订记录`.
- For unaccepted feedback: explain reason in diff plan, **still clear it** (otherwise needs_revision stays and revise repeats next round).
- For GLOBAL-FEEDBACK.md entries: **directly edit the file** — delete processed `- id: gfb-xxx` entries from the corresponding yaml block, update frontmatter `last_updated`, keep the three sections (empty section → `[]`). Even unaccepted entries should be deleted (explain reasoning in diff plan; otherwise next revise will repeat them).

### Feature / Entity / Conventions Generate

- Use this workflow when invoked via a generate prompt.
- Output a generation plan first (target file paths, structure decisions), **wait for user confirmation**.
- New files must obey the frontmatter and section conventions described above.
- Do **not** write `needs_revision` on new files (new = baseline).
- For CONVENTIONS.md: if it already exists, increment `version`, update `last_updated`, prefer 增量补全 over 整体覆盖.

### Cross-product Contract Maintenance

- Add or update contracts only when a shared API or cross-product dependency is explicit. Single-product internal APIs do not get a contract.
- Store contracts as markdown files under `data/contracts/<provider>-<consumer>-<topic>.md`.
- Keep related product feature rows linked through the `备注` column when a feature depends on or exposes the contract.
- Contract status (`draft / agreed / deprecated`) is required; default to `draft` when not yet agreed.

## Do Not

- Do not casually modify the source project being recorded by Intake (the directory referenced by `source_path`).
- Do not modify Atlas application code under `apps/` or `packages/` unless the task explicitly requests it.
- Do not introduce databases, authentication, deployment config, health scoring, export systems, AI integrations, or graph features as part of spec maintenance.
- Do not write derived metrics (progress percentages, health scores, etc.) back into markdown/yaml source data; derivation belongs in the API/web layer.
- Do not perform unrelated refactors.
- Do not reorder unrelated documentation or "tidy up" unrelated formatting.
- Do not mark merely-planned features as `live` or `done`; use `planned` or a note.
- (Round 3 early behavior reversed by 5' patch) During revise, **do** directly edit `GLOBAL-FEEDBACK.md` to remove processed entries — telling the user "please delete these ids" is no longer the policy.
- Do not write `needs_revision: true` on freshly created (generate-mode) files.
- Do not bring back the `intake_substage` field or the three-stage 立项 UI (Round 3 deliberately removed them).
- Do not restore TBD / 决策 aggregate views (Round 3 removed them; entity-level `## 决策` and `[TBD]` data is preserved in files for future restoration).

## Self-check

- When modifying `AGENTS.md` or `.claude/skills/alts/SKILL.md`, manually diff the two body sections and keep their rules semantically equivalent. v1 has no automated check; this is enforced by the editor.
- Confirm the 6-column feature table schema is preserved.
- Confirm feature ID continuity and prefix consistency within the product.
- Confirm Intake stage names and internal values still match `packages/shared/src/types.ts`.
- After a Finalize run, confirm `data/products/<id>/` contains all three required artifacts: `STATUS.md`, `meta.yml`, and `SUMMARY.md`.
- Confirm `STATUS.md` frontmatter `last_updated` is updated when the file changed.
- After a revise run, confirm each touched file has `needs_revision` removed, `## 反馈池` emptied, `## 修订记录` appended.
- After a generate run, confirm new files do **not** carry `needs_revision: true`.
- If a task asks to "also" refactor parser or application code during spec maintenance, treat that as out of scope unless the user explicitly authorizes a separate implementation task.
- If an existing feature table has only 4 columns or malformed columns, fix it to the 6-column schema before relying on parsed feature data.
