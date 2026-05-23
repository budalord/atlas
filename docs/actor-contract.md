# Atlas Actor 契约

> 这份文档是 Atlas **Actor (`actors/<id>.md`)** 这一类 source-of-truth 文件的形式契约。
> Actor 是项目级 first-class 对象, 与 Entity / Capability 并列, 用于描述"谁参与了产品的能力"。
>
> **修改本契约需要架构层级审批, 不要由实现侧自行调整。**

---

## 1. 目的与作用域

### 1.1 这份契约钉的是什么

钉 **actors/<id>.md 文件的结构形态**:
- 物理位置: `data/products/<id>/actors/<actor_id>.md`(一文件一 actor)
- frontmatter 必填字段
- body 自由叙述

### 1.2 这份契约不钉的是什么

- Actor 之间的关系 (没有 actor → actor 直接引用, 用 capability 反查)
- 全局 `data/roles.yml` (legacy seed, 不强制存在; v0.1 后逐步退化)
- 派生层如何使用 Actor (各派生 contract 自钉)

### 1.3 设计原则

1. **项目级隔离** — Actor 是 product-scoped 的 first-class 对象。同名 actor 在不同产品里语义可以不同, 不强求跨产品复用。
2. **真源单向写** — Actor 只存自己的描述, 不存"我关联了哪些 capability" 反向引用。**`related_capability_ids` 由 loader 运行时聚合**, 不入 frontmatter (规则 4, 见 plan-generic-elephant)。
3. **agent-friendly 容错** — 缺段 / 格式坏 → parser 返回 undefined, 不阻塞产品加载。

---

## 2. actors/<id>.md 完整形态

```yaml
---
# ─── 必填 frontmatter ──────────────────
id: sales                            # kebab-case, 产品内全局唯一
name: 销售                            # 中文显示名
type: internal_user                  # 见 §2.1 枚举
source: user_input                   # 见 §2.2 枚举
confirmed: true                      # bool

# ─── 选填 frontmatter ──────────────────
code: SALES                          # 大写代码, 可选 (用于代码生成里的 enum)
responsibilities: 学员录入 / 订单录入 / 推荐人跟进
                                     # 一句话职责摘要 (markdown 自由文本)

# ─── 不允许出现的字段 ────────────────────
# ❌ related_capability_ids  (loader 运行时聚合, 不入 md)
# ❌ related_function_ids    (同上)
# ❌ related_usecase_ids     (同上)
---

# <name>

<自由叙述, 业务描述, 决策者视角>

## 关键能力 (Atlas 自动渲染 · 勿手写)
<!-- 这块 UI 在渲染时自动从 loader 聚合的 related_capability_ids 填, 你写 md 时不要手填 -->
```

### 2.1 `type` 枚举

| 值 | 语义 | 示例 |
|----|------|------|
| `internal_user` | 内部用户(机构员工) | 销售 / 教务 / 财务 / 校长 |
| `external_user` | 外部用户(客户/家长/学员等) | 学员 / 家长 / 合作商 |
| `external_system` | 外部系统(集成方/平台) | 飞书 / 凡科 / 抖音 / 微信支付 |

非合法值仍透传, UI 显示 ⚠。

### 2.2 `source` 枚举

| 值 | 语义 |
|----|------|
| `user_input` | 用户手动录入 |
| `agent_suggested` | Wizard / 反问中 agent 建议 |
| `inferred_from_function` | 反推时从 function.actor_ids 推出 |

---

## 3. 命名规范

- `id`: **kebab-case**, 产品内全局唯一 (eg. `sales` / `partner` / `feishu`)
- `name`: 中文显示名 (eg. `销售` / `合作商` / `飞书`)
- `code`: 大写蛇形 (eg. `SALES` / `PARTNER`), 可选 — 主要给代码生成期取用
- **不允许**两个 actor 同 `id`(loader 启动校验, 重复抛错)

---

## 4. API 接口

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/products/:id/actors` | 列出全部 actor (含 *WithRefs 聚合反向引用) |
| GET | `/api/products/:id/actors/:actorId` | 单个 actor 含 refs |
| POST | `/api/products/:id/actors` | 创建 |
| PATCH | `/api/products/:id/actors/:actorId` | 改 |
| DELETE | `/api/products/:id/actors/:actorId` | 删 |

DELETE 不级联清理引用(避免误伤), 但 l0Linter 会检测出 stale 引用 → ReviewDashboard 警告。

---

## 5. 非功能性约束

- **无缓存**: 每次请求 loader 走盘(yunkai-erp 量级下完全 hold 住), SSE data-change 只通知前端刷新, 不维护内存状态。 — 规则 5
- **反向引用运行时聚合**: `ActorWithRefs.related_capability_ids` 通过扫所有 capability.md 的 actor_ids 反查, 不缓存 — 规则 4

---

## 6. 与其他契约的关系

```
actor-contract.md (本文档)
    │
    └─ 被引用 ← docs/capability-contract.md (capability.actor_ids 引用 actor.id)
                                              ↓
                                       反向聚合 → ActorWithRefs.related_capability_ids
    └─ 被引用 ← docs/feature-source-contract.md (function.actor_ids 引用 actor.id)
    └─ 被引用 ← docs/usecase-contract.md (usecase.actor_id 引用 actor.id)
```

---

## 7. 修改流程

- 改 §2 frontmatter 字段 → 必须同步改 parser + UI 卡片 + 所有引用契约
- 改 §2.1 type 枚举 → 必须同步改前端 type filter / 矩阵颜色编码
- §3 / §4 / §6 是说明性, 可独立更新

### 修改 trail

- 2026-05-23: 初稿 v0.1 (rev3 五层骨架重构, 见 plan-generic-elephant.md)
