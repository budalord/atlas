# Atlas ARCHITECTURAL-WARNINGS.md Source 契约

> 这份文档是 Atlas **产品级架构警告(`ARCHITECTURAL-WARNINGS.md`)** 的形式契约。
> 是 Agent / 用户写警告、Atlas parser 读警告、UI 显示卡片之间的接口规范。

---

## 1. 目的与作用域

钉 `ARCHITECTURAL-WARNINGS.md` 文件的结构形态:

- 文件位置:`data/products/<id>/ARCHITECTURAL-WARNINGS.md`(产品根目录,单文件)
- 每个警告一个 H2 块: `## 警告 N · 标题 [<status>]`
- 块内 4 个固定粗体小标题(均可选)
- status enum:`待承接 | 部分承接 | 已纳入`(默认 `待承接`)

---

## 2. ARCHITECTURAL-WARNINGS.md 完整形态

```markdown
> Derived from <source>.  (可选 leading comment)

# 架构警告
(可选 preamble 段落)

## 警告 1 · 产品版本化 [已纳入]

**学长原话**:
> 备注:"历史订单价格"与"产品当前价格"解耦,通过"产品版本化管理"实现

**学长原意**: 价格调整时,已签订单的金额不能变。

**整体规格承接**:
- A 产品线核心要求
- Product 实体引入双版本号

**含义**: 从 v1 开始,所有涉及"产品 → 订单 → 权益"的链路都必须带版本号。

---

## 警告 2 · ...
```

### 2.1 H2 头格式

```
## 警告 <id> · <title> [<status>]
```

- `<id>`: 数字(`1` / `2` / ...) 或任意非空字符串
- `<title>`: 一句话标题
- `<status>`: 可选,缺省 `待承接`。合法值:

| 值 | 语义 |
|----|------|
| `待承接` | 默认 — 警告未承接到任何 source(规格/feature/entity 都未体现) |
| `部分承接` | 部分内容已落到 source,余下待补 |
| `已纳入` | 全部承接 — 警告内容已在 source 体现 |

### 2.2 块内 4 个粗体小标题(均可选)

| 小标题 | 内容 |
|--------|------|
| `**学长原话**:` 或 `**原话**:` | 原始引用,允许 `> quote` 块 |
| `**学长原意**:` 或 `**原意**:` | 解读 / 背景 |
| `**整体规格承接**:` 或 `**承接**:` | 该警告在 source 中如何被落实 |
| `**含义**:` | 影响范围 / 启示 |

---

## 3. Parser 容错

| 情形 | 处理 |
|------|------|
| H2 标题不匹配 `## 警告 N` 格式 | 跳过该 H2 |
| 块内缺所有小标题 | 4 字段为空,body 仍保留 |
| `[<status>]` 非合法 enum | 默认 `待承接` |
| 4 字段同义词混用(学长原话 / 原话) | 都识别 |

---

## 4. API 接口

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/products/:id/architectural-warnings` | 返回结构化警告列表 + preamble + last_modified |
| POST | `/api/products/:id/architectural-warnings` | body: `{ title, originalQuote?, interpretation?, resolution?, implication? }` → 自动算下一个 id |
| PATCH | `/api/products/:id/architectural-warnings/:wid/status` | body: `{ status }` → 改 H2 标题 `[status]` 标签 |

---

## 5. UI 行为(规格 tab · 决策与警告子页签)

1. 卡片列表,与决策卡片并排放(决策在上,警告在下)
2. 折叠状态:仅显示 警告 N · 标题 + status badge(颜色:红 待承接 / 橙 部分承接 / 绿 已纳入)
3. 展开:4 个段(原话 quote block / 原意 / 承接 / 含义)+ status 切换按钮(`待承接` / `部分承接` / `已纳入`)

---

## 6. 修改流程

- 修改 §2 H2 格式 / 4 小标题 / status enum → 同步修改 parser + UI
- §3 容错 / §4 / §5 是说明性,可独立更新
