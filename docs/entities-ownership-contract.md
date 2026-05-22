# Atlas ENTITIES-OWNERSHIP.md Source 契约

> 这份文档是 Atlas **产品级实体归属清单(`ENTITIES-OWNERSHIP.md`)** 的形式契约。
> 是 Agent / 用户写表、Atlas parser 读表、UI 交互式编辑、派生 Agent 消费之间的接口规范。
>
> **修改本契约需要架构层级审批,不要由实现侧自行调整。**

---

## 1. 目的与作用域

### 1.1 这份契约钉的是什么

钉 `ENTITIES-OWNERSHIP.md` 文件的**结构形态**:

- 文件位置:`data/products/<id>/ENTITIES-OWNERSHIP.md`(产品根目录,单文件)
- 必须含 `## 完整归属清单` H2 段,段内是 4 列固定表格
- 表格行有两种:分组分隔行(粗体 + 其余 cell 空)和数据行
- 数据行第 1 列 `EntityName(中文别名)` 拆分规则

### 1.2 不钉的是什么

- 表格之外的章节(`## 关键派生关系` / `## 跨校区操作的处理原则` / 等)— 自由 markdown,UI 仅展示不解析
- 归属层(layer)的具体枚举值 — 自由文本,但有**约定值**(见 §3)
- 实体 id 命名规则 — 由 docs/flowchart-contract.md §3.4 约束(PascalCase)

### 1.3 设计原则

1. **单文件 + 单表**:不切分到 entities/<name>.md,与 yunkai-erp v1 §8 保持一致
2. **分组可选**:分组分隔行只是视觉聚类,不强制
3. **派生 Agent 读为主、UI 小手术为辅**:Agent 一次写整个表,UI 仅做加行 / 改单元格 / 删行
4. **永不阻塞**:任何子段缺失 → 对应字段为空,继续

---

## 2. ENTITIES-OWNERSHIP.md 完整形态

```markdown
> Derived from <source>.    (可选 leading comment)

# 实体的机构 / 校区归属清单

<可选 preamble 段落>

## 完整归属清单

| 实体 | 归属 | 维护权限 | 备注 |
|------|------|----------|------|
| **D 字典层** |  |  |  |
| MajorCategory(大类) | 机构层 | 校长 | 影响业务结构 |
| Direction(方向) | 机构层 | 校长 | 仅计算机大类有 |
| **A 产品层** |  |  |  |
| Product(产品) | 机构层 | 销售 + 教务双侧 | 销售侧维护价格,教务侧维护服务清单 |
| ...

## 关键派生关系
<自由 markdown — UI 仅展示>

## 跨校区操作的处理原则
<自由 markdown — UI 仅展示>
```

### 2.1 表格 4 列

| 列序 | 表头 | 内容 | 形态 |
|------|------|------|------|
| 1 | 实体 | `EntityName(中文别名)` 或 `EntityName` | PascalCase + 可选括号别名 |
| 2 | 归属 | layer 自由文本 | 推荐约定值(§3) |
| 3 | 维护权限 | maintainers 文本 | 自由 |
| 4 | 备注 | note 文本 | 自由,可引用决策号 `D-NN` |

### 2.2 分组分隔行

第 1 列用粗体包裹分组名,其余 3 列为空:

```
| **D 字典层** |  |  |  |
```

UI 渲染为淡灰色 subheader 行;数据行紧随其后归属于该分组。

### 2.3 `## 完整归属清单` 之外的内容

- preamble:第一个 H2 之前的所有内容(含 leading comment + H1 + 段落 + 介绍表)
- trailing:`## 完整归属清单` 表格结束后的所有内容(含 `## 关键派生关系` 等)

两者在解析时**保留为 raw markdown**,写盘时**完整透传**。

---

## 3. 归属(layer)的约定值

自由文本,但派生 Agent 期望以下值之一(或以这些为基础的扩展):

| 值 | 语义 | 派生 Agent 行为 |
|----|------|----------------|
| `机构层` | 跨场地/校区共享 | 实体 schema 不加 campus_id |
| `校区(硬隔离)` | 严格按校区切分 | 实体加必填 campus_id,跨校区不可见 |
| `校区(软隔离)` | 按校区切分但可 shareable | 实体加 campus_id + shareable 标记字段 |
| `校区(由学员决定)` / `校区(由 <Entity> 决定)` | 校区由关联实体决定 | campus_id 来自 FK |
| `跟随 <Entity>` | 归属继承自另一实体 | campus_id 不独立,FK 拿 |
| `本校区` | 角色或资源严格本校区 | 用于角色定义,非典型实体 |
| `可配置` | 归属由配置决定 | 实体加 scope_mode 字段 |
| `跨校区` | 角色或顶层资源跨所有校区 | 用于校长 / 总裁等 |

**派生 Agent 不要硬编码这些 enum**,仅做 substring 匹配 + reconcile 报告(派生与声明不一致 → 出 ticket)。

---

## 4. Parser 容错规则

| 情形 | 处理 |
|------|------|
| 没有 `## 完整归属清单` H2 | rows=[], preamble 取整个文件 |
| 表格列数 < 4 | 跳过该行 |
| 表格分隔行(`|-----|`) | 跳过 |
| 第一行无表头(没"实体"字样) | 仍尝试解析,把第一行当数据(可能误吸,接受 — 用户应保证表头存在) |
| 第 1 cell 不是 `EntityName(...)` 也不是粗体 | 视全字符串为 name,alias 为空 |
| 分组分隔行的第 1 cell 不在粗体内 | 视为普通数据行 |
| 重复 entity name | 按文件中出现顺序保留全部(UI 显示 ⚠) |

---

## 5. API 接口

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/products/:id/entities-ownership` | 返回 `EntitiesOwnershipData`(exists + rows + preamble + trailing + last_modified) |
| POST | `/api/products/:id/entities-ownership/row` | body: `{ name, alias?, layer, maintainers?, note?, group? }` → 加新行;`group` 指定分组分隔行后插入,缺省追加表末 |
| PATCH | `/api/products/:id/entities-ownership/row/:name` | body: `{ alias?, layer?, maintainers?, note? }` → 只改指定字段;name 不可改 |
| DELETE | `/api/products/:id/entities-ownership/row/:name` | 删除指定 entity 行(分组分隔行不可删) |

POST 写盘:
- 文件不存在时新建(preamble 自动加 `# 实体的机构 / 校区归属清单` H1)
- 同名 entity 已存在 → 409
- group 指定的分组不存在 → 创建分组分隔行 + 加 entity

PATCH/DELETE:
- 文件不存在 → 404
- 找不到 entity → 404

---

## 6. UI 行为(规格 tab · 跨模块契约子页签)

1. 表格视图,行 = entity,列 = 归属 / 维护权限 / 备注 / 备注栏右侧 affected features chips
2. **筛选**:全部 / 机构层 / 校区 / 跟随 X / 其他 — substring 匹配 layer 列
3. **行内编辑**:单击单元格切换为 input;失焦或回车提交 PATCH
4. **删除**:行末 × 按钮 → 确认 → DELETE
5. **加新行**:表底"加新行"按钮 → 弹表单 → POST
6. **affected features**:右侧 chip 列表,通过反查 features(`features.entities_touched` 包含此 entity name)填充;点 chip 跳到 feature
7. 只读 phase(live / paused / archived):隐藏所有编辑入口,仅看

trailing 段(`## 关键派生关系` / `## 跨校区操作的处理原则`)在表下方作为只读 markdown 展示。

---

## 7. 与其他契约的关系

- 与 `docs/feature-source-contract.md`:feature.entities_touched 列表 ⟷ ENTITIES-OWNERSHIP 的 entity 行(双向反查)
- 与 `docs/entity-contract.md`(待写):派生实体 Agent 把 ENTITIES-OWNERSHIP 作为 ground truth,派生产物的 ownership 字段从此表来
- 与 `docs/seams-contract.md`:SEAMS 数据契约里出现的 Entity 应该都在本表里
- 与 `docs/decisions-contract.md`:备注列允许 `D-NN` 引用(UI 后续可 linkify)

---

## 8. 修改流程

- 修改 §2 表格结构(列数 / 列序 / 分组规则)→ **必须**同步修改 parser + renderer + UI 表格
- 修改 §3 归属约定值 → 仅 UI 提示,parser 透传
- 修改 §4 容错规则 → 仅改 parser
- §1 / §5 / §6 / §7 是说明性,可独立更新
