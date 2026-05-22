# Atlas SEAMS.md Source 契约

> 这份文档是 Atlas **产品级跨模块接缝(`SEAMS.md`)** 的形式契约。
> 是 Agent / 用户写接缝、Atlas parser 读接缝、UI 展示接缝卡片之间的接口规范。
>
> **修改本契约需要架构层级审批,不要由实现侧自行调整。**

---

## 1. 目的与作用域

### 1.1 这份契约钉的是什么

钉 `SEAMS.md` 文件的**结构形态**:

- 文件位置:`data/products/<id>/SEAMS.md`(产品根目录,单文件)
- 接缝块的 H2 标题格式
- 块内 5 个固定字段(调用方 / 被调用方 / 触发时机 / 数据契约 / 异常处理)
- 数据契约段允许 typescript-like 代码块(UI 高亮渲染)

### 1.2 不钉的是什么

- 接缝内容本身的质量 / 数量(Agent 自行根据产品规模决定)
- 接缝 id 命名规则(可用 5.1 / A→B / 任意可识别字符串)
- 是否拆分到 `seams/<id>.md`(本阶段保持单文件 SEAMS.md;后续阶段如需要再切分)

### 1.3 设计原则

1. **单文件** for v1(后续阶段如发现并发写盘是瓶颈,再考虑切分)
2. **统一模板**:每接缝 5 字段固定承载,降低 Agent 生成 + parser 解析的不确定性
3. **数据契约 typescript-friendly**:允许 ```` ```ts ```` 或自由 markdown,parser 提取 body,UI 看到代码块自动高亮
4. **永不阻塞**:任何解析失败 → 跳过该接缝,不报错

---

## 2. SEAMS.md 完整形态

```markdown
> Derived from <source>. 单一事实源是 <source>;若不一致以 <source> 为准。
(可选 leading comment block)

# 跨线接缝契约(N 个)

接缝是整体规格的**最重要内容**。字段级规格由各线自己定,但接缝必须在整体规格里锁死。

每个接缝按统一模板:**调用方 → 被调用方 / 触发时机 / 数据契约 / 异常处理**。

---

## <seamId> <title>

- **调用方**: <模块 / 线名>(可附说明)
- **被调用方**: <模块 / 线名>(可附说明)
- **触发时机**: <事件 / 时机描述>

**数据契约**:
- <字段映射列表 / 或 typescript-like 代码块>

```ts
interface OrderToFinance {
  reported_amount: number;
  verified_amount: number;
  finance_review_status: 'pending' | 'approved' | 'rejected';
}
```

**异常处理**:
- <场景 1> → <处理>
- <场景 2> → <处理>

---

## <seamId 2> <title 2>

...
```

### 2.1 H2 头格式

```
## <seamId> <title>
```

合法 seamId 形态:

| 形态 | 例 | 备注 |
|------|-----|------|
| `N.M` | `5.1` | 数字章节号(yunkai-erp v1 风格) |
| `A→B` | `A→B` 或 `A → B` | 业务线代号 + 箭头 |
| `A⟷B` | `C⟷F` | 双向接缝 |
| 任意非空字符串 | `order-to-finance` | 推荐 kebab-case 英文 id |

title 是 H2 行除 id 之外的所有内容(可含括号说明)。

### 2.2 块内 5 个固定字段

| 字段 | 必填 | 形态 | 说明 |
|------|------|------|------|
| `- **调用方**:` | 强烈建议 | 单行 | 主动发起的一侧 |
| `- **被调用方**:` | 强烈建议 | 单行 | 被动响应的一侧;双向接缝时填两边 |
| `- **触发时机**:` | 强烈建议 | 单行 | 事件或时机的一句话描述 |
| `**数据契约**:` | 必填 | 多行 | 字段映射 / TS interface 代码块 / 自由 markdown |
| `**异常处理**:` | 建议 | 多行 | 异常场景的处理规则列表 |

**注**:
- 前 3 个用列表项(`-`)前缀,后 2 个不用列表项(直接段标题 + 内容)
- 数据契约段可有任意 markdown 内容,parser 把它从 `**数据契约**:` 取到下个 `**xxx**:` / `---` / `## ` / 文末为止
- 异常处理段同理

### 2.3 typescript-like 代码块

数据契约段允许嵌:

```markdown
**数据契约**:

```ts
interface Order {
  product_ids: string[];
  service_version_id: string;
  pricing_version_id: string;
}
```
```

UI 看到 ```` ```ts ```` 或 ```` ```typescript ```` 代码块时使用语法高亮(本阶段简化为带 monospace + slate 背景的 `<pre>`,后续可接 react-syntax-highlighter)。

---

## 3. Parser 容错规则

| 情形 | 处理 |
|------|------|
| 没有 `# 跨线接缝契约` H1 | 仍尝试解析 H2 块 |
| H2 标题 id 格式错(全空) | 跳过该块 |
| 块内缺所有字段 | 该接缝 caller/callee/trigger/dataContract/exceptions 均为空,但 body 保留 |
| `**调用方**:` 没用列表项前缀 | 仍能解析(parser 容忍可选 `-` 前缀) |
| 重复 seamId | 全部保留(UI 显示警告) |

---

## 4. API 接口

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/products/:id/seams` | 返回结构化接缝列表(`Seam[]` + exists + last_modified) |

阶段 3 暂不提供 POST/PATCH(接缝由 Agent 写为主,UI 不做小手术)。

后续阶段如需 UI 加新接缝,可加 POST 接口(对应"加新接缝"表单)。

---

## 5. UI 行为(规格 tab · 跨模块契约子页签)

1. 接缝卡片 grid 布局(类似 features 列表)
2. 折叠状态:仅显示 seamId + title + caller→callee + trigger
3. 展开状态:渲染 body 全 markdown(包括代码块高亮)
4. 不提供"加新接缝"按钮(阶段 3),用户直接编辑 SEAMS.md

---

## 6. 与其他契约的关系

- 与 `docs/feature-source-contract.md`:feature.description "触发后续" 段可引用接缝号(如 `经 接缝 5.3`)
- 与 `docs/entity-contract.md`(待写):派生实体 Agent 必须读 SEAMS.md 提取字段定义
- 与 `docs/decisions-contract.md`:SEAMS 块的 body 可引用 `D-NN`,UI 自动 linkify
- 与 `docs/flowchart-contract.md`:流程图节点的 scope 可引用接缝号

---

## 7. 修改流程

- 修改 §2 H2 格式 / 字段顺序 / 必填项 → **必须**同步修改 parser + UI 卡片
- 修改 §3 容错规则 → 仅改 parser,source 文件不动
- §1 / §4 / §5 / §6 是说明性,可独立更新

## 8. 未来扩展(本阶段不做)

- 拆分到 `seams/<id>.md`(类似 features/)
- 数据契约 schema 校验(把 TS interface 编译/AST-parse,验证字段类型)
- 与派生实体的 reconcile(接缝声明字段 vs 派生实体字段 → 差异 ticket)
