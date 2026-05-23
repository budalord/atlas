# Atlas Capability 契约

> 这份文档是 Atlas **Capability (`capabilities/<id>.md`)** 这一类 source-of-truth 文件的形式契约。
> Capability 是"业务域 + 一组功能的集合"的 first-class 表达, 取代了 v0.0 中的 MODULE.md `groups[]`。
>
> **修改本契约需要架构层级审批, 不要由实现侧自行调整。**

---

## 1. 目的与作用域

### 1.1 这份契约钉的是什么

- 物理位置: `data/products/<id>/capabilities/<capability_id>.md`(顶层目录, 与 entities/ 平级, **不嵌套在 modules/ 下**)
- frontmatter 必填字段 + status 状态机 + domain 预定义池
- body H2 段结构

### 1.2 这份契约不钉的是什么

- Capability 之间的层级关系 (没有"父子 capability", 业务域分组靠 domain 字段)
- Capability 与 Function 的多对多 (一个 capability N 个 function, 一个 function 只能属一个 capability, 由 function.capability_id 单向定义)
- 派生层使用方式 (entity 派生 / 流程图派生 各自钉)

### 1.3 设计原则

1. **跨模块合法** — 一个 capability 可以聚合来自 sales 和 jiaowu 两个 module 下的 function。这是把 module 退化为物理目录 / 团队归属维度的核心动作 (走 (A) 路线, 见 plan-generic-elephant.md rev3 决策 1)
2. **真源单向写** — Capability 存 `actor_ids` / `entity_ids` (真源); **不存 `function_ids` 反向引用**, loader 运行时聚合 (规则 4)
3. **粒度有规则** — 3-10 function 为健康, < 3 或 > 10 触发 l0 警告 (规则 8)
4. **domain 强制贴标签** — 从预定义池选, 自由扩展需显式新增 (规则 2)

---

## 2. capabilities/<id>.md 完整形态

```yaml
---
# ─── 必填 frontmatter ──────────────────
id: student-intake                    # kebab-case, 产品内全局唯一
name: 学员录入                         # 动宾短语 (规则 8)
domain: 招生                          # 必填, 从预定义池选 (§2.1)
value_statement: 销售/合作商录入已购课学员档案, 建立学籍主数据
                                      # 1 句话, "谁 + 通过什么 + 达到什么目的" 模板
actor_ids:                            # 真源: 谁能调用此 capability
  - sales
  - partner
entity_ids:                           # 真源: 此 capability 涉及的实体
  - Student
  - IntakeText
  - JuniorCollege
priority: P0                          # P0 | P1 | P2
status: confirmed                     # draft | confirmed (MVP-1 仅二态, 规则 3)
source: user_input                    # user_input | agent_suggested | inferred_from_features
confirmed: true                       # bool

# ─── 不允许出现的字段 ────────────────────
# ❌ function_ids    (loader 运行时聚合, 不入 md)
# ❌ related_*       (同上)
---

# <name>

## 业务描述
<自由叙述, 业务场景, 关键约束>

## 关键决策
<可选, 链接 DECISIONS.md 的 D-id 摘要>
- D-43: 学员录入时确定校区
- ...

## 关联功能 (Atlas 自动渲染 · 勿手写)
<!-- 这块 UI 在渲染时自动从 loader 聚合的 function_ids 填 -->
```

### 2.1 `domain` 预定义池

v0.1 初始 6 个 domain(基于 yunkai-erp 实际场景), 后续可显式新增:

| domain | 涵盖 |
|--------|------|
| `招生` | 学员录入 / 渠道 / 推荐 / 订单创建 |
| `教务` | 学籍 / 排课 / 考勤 / 学情 / 教师 |
| `财务` | 回款 / 退费 / 发票 / 报表 |
| `人事` | 教师管理 / 提成 / KPI |
| `数据集成` | 凡科回灌 / 飞书同步 / 微信支付对接 / 抖音渠道 |
| `决策与报表` | 招生漏斗 / 财务报表 / 教师满意度 / 销售排名 |

反推时 **强制贴标签**, 不允许写"市场招生 / 招生与市场" 等变体。若实在不属于任何一个, 显式开 PR 加新 domain 到此契约 + 升级 enum。

### 2.2 `status` 状态机 (MVP-1 二态)

```
draft ─── 校验通过 ───> confirmed
         (actor_ids 非空
        + entity_ids 非空
        + value_statement 非空
        + ≥ 1 个 function 归属)
```

- 反向: confirmed → draft 允许 (任何条件不满足时), 由用户手动或 l0Linter 触发
- `in_design` / `implemented` 留到后续 implementation tracking feature, MVP-1 不用

### 2.3 `priority` 取值

| 值 | 语义 |
|----|------|
| `P0` | 必须实现, 立项核心 |
| `P1` | 重要, 但可以 phase 2 实现 |
| `P2` | 可选 / nice-to-have |

### 2.4 `source` 枚举

| 值 | 语义 |
|----|------|
| `user_input` | 用户手动录入 |
| `agent_suggested` | Wizard / 反问中 agent 建议 |
| `inferred_from_features` | 反推时从 module_group / function 聚合推出 |

---

## 3. 命名规范

- `id`: **kebab-case**, 产品内全局唯一 (eg. `student-intake` / `order-creation`)
- `name`: **动宾短语** (eg. `学员录入` / `订单创建` / `退费处理`), **不要**用名词性短语(`学员管理`)或修饰短语(`学员相关`) — 这种是 module / domain 级别, 不是 capability
- **不允许**两个 capability 同 `id`(loader 启动校验, 重复抛错)

---

## 4. 粒度规则 (规则 8 落地)

| 情形 | l0 警告 | 建议 |
|------|---------|------|
| 一个 capability 下 0 个 function | ⚠ 警告: 空 capability | 删 / 补 function / 改 status=draft |
| 一个 capability 下 1-2 个 function | ⚠ 提示: 粒度过细 | 合并到相近 capability, 或确认是有意拆细 |
| 一个 capability 下 3-10 个 function | 健康 (无警告) | — |
| 一个 capability 下 > 10 个 function | ⚠ 提示: 粒度过粗 | 按业务子域 / actor 主导差异拆分 |

l0Linter 实时统计, 在 ReviewDashboard 显示。

---

## 5. API 接口

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/products/:id/capabilities` | 列出全部 capability(含 *WithRefs 聚合 function_ids) |
| GET | `/api/products/:id/capabilities/:capabilityId` | 单个含 refs |
| POST | `/api/products/:id/capabilities` | 创建 |
| PATCH | `/api/products/:id/capabilities/:capabilityId` | 改(包括 status 推进) |
| DELETE | `/api/products/:id/capabilities/:capabilityId` | 删(不级联清 function.capability_id, 由 l0 警告兜底) |

---

## 6. 非功能性约束

- **无缓存** (规则 5)
- **反向引用运行时聚合** (规则 4): `CapabilityWithRefs.function_ids` 通过扫所有 feature.md 的 capability_id 反查
- **跨 module 合法** (规则 1 决策): 一个 capability 的 function 可来自任意 module, capability.md 不绑 module

---

## 7. 与其他契约的关系

```
capability-contract.md (本文档)
    │
    ├─ 引用 → docs/actor-contract.md       (capability.actor_ids 引用 actor.id)
    ├─ 引用 → docs/entity-contract.md      (capability.entity_ids 引用 Entity 规范名)
    │
    └─ 被引用 ← docs/feature-source-contract.md  (function.capability_id 引用 capability.id)
                                                  ↓
                                          反向聚合 → CapabilityWithRefs.function_ids
```

---

## 8. 修改流程

- 改 §2 frontmatter / §2.2 状态机 → 必须同步改 parser + UI + l0Linter
- 改 §2.1 domain 池 → 同步改 markmap domain 节点渲染 + ReviewDashboard 分组
- 改 §4 粒度阈值 → 同步改 l0Linter 阈值
- §3 / §5 / §7 是说明性, 可独立更新

### 修改 trail

- 2026-05-23: 初稿 v0.1 (rev3 五层骨架重构, 见 plan-generic-elephant.md)
