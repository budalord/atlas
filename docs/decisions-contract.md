# Atlas DECISIONS.md Source 契约

> 这份文档是 Atlas **产品级决策日志(`DECISIONS.md`)** 的形式契约。
> 是 Agent / 用户写决策、Atlas parser 读决策、UI 展示决策卡片之间的接口规范。
>
> **修改本契约需要架构层级审批,不要由实现侧自行调整。**

---

## 1. 目的与作用域

### 1.1 这份契约钉的是什么

钉 `DECISIONS.md` 文件的**结构形态**:

- 文件位置:`data/products/<id>/DECISIONS.md`(产品根目录,单文件)
- 决策块的 H3 标题格式
- 块内固定 4 个粗体小标题
- status 枚举(`active` / `superseded` / `archived`)
- legacy 兼容:旧形态(表格行)允许保留,parser 同时识别

### 1.2 不钉的是什么

- 决策的具体内容质量(用户自己负责)
- 决策块的顺序(parser 按 D-id 数字升序输出)
- DECISIONS.md 之外的章节标题(可任意加 `## 12.1` 之类的分组,parser 透明跳过)

### 1.3 设计原则

1. **单文件**:不切分到 decisions/<id>.md,与 yunkai-erp v1 §12.1/§12.2 分组语义保持一致
2. **H3 块为主形态**:统一格式,Agent 写 + parser 读 + UI 卡片渲染都好处理
3. **legacy 表格行兼容**:旧形态 `| D-NN | 决策 | 理由 |` 仍能被解析为 minimal Decision
4. **永不阻塞**:任何解析失败 → 跳过该项,不报错

---

## 2. DECISIONS.md 完整形态

```markdown
> Derived from <source>. 单一事实源是 <source>;若不一致以 <source> 为准。
(可选 leading comment block)

# 决策日志

(可选 ## 分组标题,用于 Agent 自由组织;parser 透明跳过)
## 整体规格 v1 锁定的决策(D-23 ~ D-47)

### D-47 · 2026-05-15 · 网课平台抽象 [active]

**决策摘要**: v1 中期以凡科为主,schema 不写死
**影响 features**: video-watch-fanke, course-import
**来源段**: SPEC-V1.md §7.3
**说明**: <自由叙述,可多段落,可含 markdown / 代码块>

### D-46 · 2026-05-15 · 已知开放项后置 [active]

**决策摘要**: lead 双向输送等开放项在 v1 不展开
**影响 features**: (空 — 跨多 feature 影响)
**来源段**: SPEC-V1.md §11
**说明**: ...
```

### 2.1 H3 头格式

```
### D-<N> [· <YYYY-MM-DD>] [· <title>] [<[status]>]
```

- **D-<N>**:必须 `D-` 前缀 + 数字。是决策的唯一 id
- **日期**(可选):`YYYY-MM-DD` ISO 格式,放在第一个 ` · ` 后
- **title**(强烈建议):一句话标题,放在日期后
- **[status]**(可选,默认 active):末尾方括号包 enum 值

合法 status:

| 值 | 语义 |
|----|------|
| `active` | 默认 — 决策仍然生效 |
| `superseded` | 被新决策覆盖(应在 body `**说明**` 中引用新决策号) |
| `archived` | 已归档 — 业务不再相关 |

### 2.2 块内固定 4 小标题

| 小标题 | 必填 | 类型 | 说明 |
|--------|------|------|------|
| `**决策摘要**:` | 强烈建议 | 一句话 | UI 卡片折叠时显示的概要 |
| `**影响 features**:` | 建议 | 逗号列表 | feature id(parser 用 `,` / `,` / `、` 切分);UI 自动交叉链接到 feature |
| `**来源段**:` | 可选 | 自由 | 引用源文件 + section,如 `SPEC-V1.md §7.3` |
| `**说明**:` | 建议 | 多行 markdown | 详细叙述。可含子段、代码块、链接 |

**注**:`**说明**:` 段是该块剩余的所有内容(parser 把它当作 `body` 字段)。

### 2.3 legacy 表格形态(兼容,不推荐新写)

```markdown
## 12.1 整体规格 v1 锁定的决策

| 序号 | 决策 | 理由 |
|------|------|------|
| **整体定位类** | | |
| D-23 | 全面自研 ERP | 郝伟锁定的路线 |
| D-24 | AI 工作流要预留接口 | 后续工作,要预留路径 |
```

parser 行为:
- 解析为 minimal Decision:`{ id, summary (= cell[1]), body (= cell[2..] 余下列拼成 `**理由**: ...`), date='', status='active', affectedFeatures=[], sourceRef='' }`
- 与 H3 块共存时,**H3 块优先**:同 D-id 出现 H3 块时,table 行被丢弃

---

## 3. Parser 容错规则

| 情形 | 处理 |
|------|------|
| 没有 `# 决策日志` H1 | 仍尝试解析 H3 块 / 表格行 |
| H3 标题 id 格式错(非 `D-\d+`) | 跳过该块 |
| H3 块缺所有小标题 | summary/affectedFeatures/sourceRef 空,body=块剩余原文 |
| `[status]` 是未知 enum | 视作 `active`,日志 warning |
| 日期非 ISO 格式 | 视作 title 第一段,date 为空 |
| `**影响 features**:` 用 `;` 而非 `,` | 仅按逗号 / 顿号切分,其它分隔符整段保留 |
| 同 D-id 出现多次 H3 块 | 取第一个,后续丢弃(parser 不报错) |

---

## 4. API 接口

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/products/:id/decisions` | 返回结构化决策列表(`Decision[]` + exists + last_modified) |
| POST | `/api/products/:id/decisions` | body: `{ title, summary?, affectedFeatures?, sourceRef?, body?, date? }` → 自动算 D-N+1,追加到末尾 |
| PATCH | `/api/products/:id/decisions/:did/status` | body: `{ status }` → 改 H3 块的 `[status]` 标签;legacy 表格行不支持 |

POST 行为:
- 文件不存在时新建 DECISIONS.md(加 `# 决策日志` H1 + 空行)
- 已存在时,追加 `\n\n<新决策块>\n` 到末尾
- 不刷写已有内容(单源原则 — 已写的不动)

PATCH 行为:
- 仅匹配 H3 块标题行的 `[status]` 标签部分
- legacy 表格行的 D-id 返回 404(用户需手动改 DECISIONS.md)

---

## 5. UI 行为(规格 tab · 决策与警告子页签)

1. 时间线:按 D-N 倒序(最近的决策最先)
2. 卡片折叠状态:仅显示 D-id + date + title + status badge + 决策摘要(一句话)
3. 卡片展开:渲染 body(markdown)+ 影响 features 列表(可点跳到 feature)+ sourceRef
4. "加新决策"按钮:弹表单(title 必填 / summary / affectedFeatures / sourceRef / body) → POST
5. status badge 可点切换(active ↔ superseded ↔ archived):走 PATCH

**只读 phase**(live / paused / archived):隐藏加新决策按钮 + status 切换 + 仍可看卡片。

---

## 6. 与其他契约的关系

- 与 `docs/feature-source-contract.md`:feature.description 提到 `D-NN` 时,UI 自动 linkify 跳到决策卡片
- 与 `docs/entity-contract.md`(待写):派生实体 Agent 必须读 DECISIONS.md,在 `## 引用决策` 段列出 D-id
- 与 `docs/flowchart-contract.md`:流程图派生 Agent 可在 questions.md 引用决策号
- 与 `docs/seams-contract.md`:SEAMS 的"双侧职责"段可引用决策号

---

## 7. 修改流程

- 修改 §2 H3 格式 / 小标题 / status enum → **必须**同步修改 parser + UI 卡片
- 修改 §2.3 legacy 表格兼容规则 → 仅改 parser,source 文件不动
- 修改 §3 容错规则 → 不影响 source,只改 parser
- §1 / §4 / §5 / §6 是说明性,可独立更新
