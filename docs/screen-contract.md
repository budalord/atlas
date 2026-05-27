# Atlas Screen 契约

> 这份文档是 Atlas **Screen (`modules/<m>/screens/<screen-id>.md`)** 这一类 source-of-truth 文件的形式契约。
> Screen 描述具体界面屏, 是「双轨设计」中**界面轨**的基本粒度 — 与 usecase 形成 M:N 对齐(一屏可承接多 usecase, 一 usecase 可跨多屏)。
>
> **修改本契约需要架构层级审批, 不要由实现侧自行调整。**

---

## 1. 目的与作用域

### 1.1 这份契约钉的是什么

- 物理位置: `data/products/<id>/modules/<module>/screens/<screen_id>.md` (按 module 分桶, 与 features/ / usecases/ 平级; 跨模块共享屏放 `modules/shared/screens/`)
- frontmatter 必填 / 引用规则 / entity_visibility 矩阵 schema
- body 7 段 H2 结构 + 反馈池约定
- 阻断级 vs 视图级校验规则

### 1.2 这份契约不钉的是什么

- Screen 之间的导航关系 / 屏间跳转(由 usecase 步骤序列隐式表达 — Screen 不写 transitions / upstream / downstream)
- 视觉物理形态(Figma / PNG / HTML) — 仅在 `prototype_url` / `preview_image` 字段作为可选 augment
- Screen 与 actor 的直接关系(从 usecase_ids 反查)
- Capability / Function 分组形态(界面轨不与业务轨强行镜像)

### 1.3 设计原则

1. **可空** — 简单 function 可以没有任何 Screen。Screen 是按需补的, 复杂多 usecase 场景才抽象
2. **真源单向写** — Screen 存 `usecase_ids` (真源), usecase 不存 "我被哪些 Screen 承接" 反向引用, loader 运行时聚合 (规则 4)
3. **拆分有规则** — §3 明确什么时候一屏承接多 usecase, 什么时候拆为多屏。 generate prompt 中的 Step 1 拆分判断按此规则
4. **字段名锁死** — `entity_visibility` 中所有字段必须存在于对应 entity 的 `## 字段` markdown 表, 不发明
5. **不与业务轨形态镜像** — 显式不对齐 Capability 分组 / Actor 角色 / Function 边界, 只在 entity 字段层、流程节点覆盖、状态变体三点对齐

---

## 2. modules/<m>/screens/<screen_id>.md 完整形态

```yaml
---
# ─── 必填 frontmatter ──────────────────
id: student-profile               # kebab-case, 与文件名一致, module 内唯一
name: 学员档案页                  # 人类可读名称
module: shared                    # module id 或 "shared"(跨模块共享屏)
usecase_ids:                      # 必填至少 1; 真源, usecase 不存反查
  - douyin-enrollment
  - offline-enrollment
  - profile-edit
entity_visibility:                # 必填至少 1 个 entity
  Student:
    default:                      # 所有 actor 默认露出
      - name
      - phone
      - channel
    role_gated:                   # 可选 — 按 actor id gate
      admin:
        - id_number
        - contract_amount
    derived_fields:               # 可选 — 派生字段(必须在 entity 字段表标 derived)
      - student_type_label

# ─── 选填 frontmatter ──────────────────
prototype_url: null               # Figma / 外链, 留 null 由人手动填
preview_image: null               # 静态预览图相对路径
added_in_phase: planning
added_at: 2026-05-27

# ─── v0.1 系统维护 ──────────────────
needs_revision: true              # 反馈池非空时由 feedbackWriter 自动写
split_suggestion: |               # agent revise / generate 时若发现该屏应拆为多屏, 写在此, 由人决策
  本屏字段在 sales 与 jiaowu 两视角差异 > 60%, 建议拆为「学员档案-销售视图」+「学员档案-教务视图」

# ─── 不允许出现的字段 ────────────────────
# ❌ actor_ids        (单向: 从 usecase_ids 反查)
# ❌ function_id      (单向: 从 usecase.function_id 反查)
# ❌ upstream_screens / downstream_screens   (由 usecase 步骤序列隐式表达)
# ❌ ui_states        (降到 body, 不进 frontmatter)
---

# <name>

## 用途
一句话描述这个屏的核心职责。

## 拆分理由
来自 Screen Generate prompt Step 1 拆分判断输出。 说明为什么这个屏承接这组 usecase 而不是更多/更少。

## 信息架构
顶部 / 主体 / 侧栏 / 底部各承载什么。 纯文本描述, 不写 CSS / 像素值。

## 字段可见性补充说明
仅当 frontmatter `entity_visibility` 矩阵不够表达时使用(如"管理员视图下 id_number 仅在编辑模式露出, 查看模式脱敏")。
否则写"(略, 见 frontmatter.entity_visibility)"。

## 状态变体
- **loaded**: 默认加载完成态描述
- **empty**: 空数据时显示什么(eg. "无学员档案 — 引导回销售工作台")
- **loading**: 占位骨架描述
- **error**: 错误信息样式
- **no_permission**: 越权访问时显示什么

## 设计决策
关键 trade-off 与理由。 一行一条, 简短。

## 反馈池

```yaml
- id: fb-20260527-a1b2c3
  date: 2026-05-27
  content: |
    管理员视图下应该露出推荐人字段
```

空池写 `[]`。 agent revise 完毕将本段重置为空池, 并删除 frontmatter.needs_revision。

## 修订记录
(可选)agent revise 后追加一行:
- 2026-05-27: 基于 N 条反馈修订 - 简短说明
```

### 2.1 必填字段说明

| 字段 | 类型 | 约束 |
|------|------|------|
| `id` | string | kebab-case, 与文件名一致, module 内唯一 |
| `name` | string | 中文短句, 人类可读名称 |
| `module` | string | kebab-case module id 或 `shared`(跨模块共享屏) |
| `usecase_ids` | string[] | 至少 1 个, 引用存在的 usecase.id |
| `entity_visibility` | object | 至少 1 个 entity; 每个 entity 至少有 `default` 字段列表 |

### 2.2 选填字段说明

| 字段 | 默认 | 说明 |
|------|------|------|
| `prototype_url` | null | Figma / 外链原型图 |
| `preview_image` | null | 静态预览图(png/jpg)相对路径或 url |
| `added_in_phase` | 不存在 | 创建时所处 phase, 用于"进行中追加项" banner |
| `added_at` | 不存在 | 创建时间 YYYY-MM-DD |
| `needs_revision` | 不存在 | 反馈池非空时由 feedbackWriter 自动写 |
| `split_suggestion` | 不存在 | agent 提示用户该屏可能需要拆分; 用户做决策后 PATCH 清除 |

### 2.3 entity_visibility schema

```yaml
entity_visibility:
  <EntityName>:                   # PascalCase, 引用 derived/entities/<EntityName>.md
    default: [field1, field2]     # 必填, 所有 actor 都能看到的字段
    role_gated:                   # 可选, key 为 actor id (kebab-case)
      <actor_id>: [extra_field]
    derived_fields: [label1]      # 可选, 派生字段单列(必须在 entity 字段表标 derived)
```

字段名锁定来自 entity `## 字段` 表的「字段」列, 不发明。

---

## 3. 拆分规则(Screen 独有, 不同于 usecase §3)

### 3.1 应当合并为一个 Screen 的情形 ✅

| 情形 | 例子 |
|------|------|
| 同一组字段 + 同一类用户视角 | "学员录入" 的多渠道入口(抖音/线下/转介绍)— 都填同一组字段、都是销售视角 → 一个「学员录入页」 |
| 字段差异 < 30% + 同 actor | "退费申请" 走微信 vs 对公转账 — 仅退款渠道不同, 主字段一致 → 一个「退费申请页」 |

### 3.2 应当拆为多个 Screen 的情形 ❌

| 情形 | 例子 |
|------|------|
| 不同信息密度 / 不同操作目的 | "报名表单提交" / "审批列表查看" / "审批详情决策" → 3 个 Screen |
| 跨多角色 + 字段差异 > 40% | "学员档案" 销售视角(联系信息为主) vs 教务视角(学情为主) → 拆 2 个 Screen |
| 同 entity 但 entity_visibility 完全不同 | "Order 销售概览" vs "Order 财务对账" → 拆 |

### 3.3 边界判断公式

> 如果两个 usecase 的 `entity_visibility.default` 字段集**重合 < 60%**, 或**操作目的属于不同类型**(录入/查看/审批/决策), 或**承接的主 actor 不同 + 字段差异 > 40%** → 拆为多个 Screen。 否则合并。

### 3.4 默认偏向(防 agent 合并偏向)

大模型默认倾向"合并"(token 省 + 看起来整洁)。 Screen Generate prompt 中强制要求 agent **主动拆**, 除非两个 usecase 真的字段几乎一致 + 同视角。

---

## 4. 命名规范

- **文件名**: kebab-case, 直接用 screen_id (eg. `student-profile.md`)
- `id`: kebab-case, 与文件名一致, module 内唯一
- `name`: 中文短句, 描述这个屏(eg. "学员档案页" / "退费审批详情")
- 跨 module 共享屏:`module: shared`, 文件放在 `modules/shared/screens/` 下(shared 目录由用户明确意图时手动创建, agent 不自行 mkdir)

---

## 5. API 接口

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/products/:id/screens` | 列出全部(可选 `?usecase=<id>` / `?entity=<E>` 反查) |
| GET | `/api/products/:id/screens/orphans` | 视图级孤儿 screen 报告 |
| GET | `/api/products/:id/screens/:module/:screenId` | 单个 + validation_issues |
| POST | `/api/products/:id/screens` | 新建 (validateScreen 通过才落盘) |
| PATCH | `/api/products/:id/screens/:module/:screenId` | 改 (validateScreen 通过才落盘) |
| DELETE | `/api/products/:id/screens/:module/:screenId` | 删 |

POST/PATCH 校验:
- id / module kebab-case
- usecase_ids 全部存在
- entity_visibility 的 entity 名存在 + 被某个 usecase 引用
- entity_visibility 的字段名都在 entity 字段表

---

## 6. 校验规则

### 6.1 阻断级(routes 转 400)

| Rule | 触发条件 |
|------|----------|
| `usecase-not-found` | usecase_ids 引用了不存在的 usecase |
| `entity-not-referenced-by-usecase` | entity_visibility 引用了不存在的 entity, 或该 entity 未被 usecase_ids 中任何 usecase 的 entity_ids 引用 |
| `field-not-in-entity-fields-table` | default / role_gated / derived_fields 中的字段名不在 entity `## 字段` markdown 表 |

### 6.2 视图级(暴露不阻断)

| Rule | 触发条件 | 表达位置 |
|------|----------|----------|
| `orphan-screen` | usecase_ids 全部找不到对应 usecase | `GET /api/products/:id/screens/orphans` |
| `field-not-in-entity-fields-table`(warning) | `derived_fields` 中的字段在 entity 字段表存在但未标 derived | validation_issues 中 level=warning |

---

## 7. 非功能性约束

- **无缓存** (规则 5)
- **反向引用运行时聚合** (规则 4): `loadScreensForUseCase` / `loadScreensForEntity` 通过扫所有 screen.md 反查
- **Screen 可空**: 一个 function 没有 Screen 是合法的(简单 function 不需要)
- **跨 module 共享屏路径**: shared/ 目录仅在用户明确意图时手动创建, agent 不自行 mkdir(避免散乱)

---

## 8. 与其他契约的关系

```
screen-contract.md (本文档)
    │
    ├─ 引用 → docs/usecase-contract.md   (screen.usecase_ids 引用 usecase.id)
    ├─ 引用 → docs/entity-contract.md    (screen.entity_visibility 的 entity 名 + 字段名)
    │
    └─ 反查 ← usecase / entity            (loader 通过 loadScreensFor* 反向聚合)
```

---

## 9. 修改流程

- 改 §2 frontmatter → 必须同步改 screenLoader 的 parseScreen + ScreenList UI
- 改 §3 拆分规则 → 必须同步改 generatePromptBuilder.buildScreenGeneratePrompt 的 Step 1 文案
- 改 §6 校验规则 → 必须同步改 screenLoader.validateScreen
- §4 / §5 / §8 是说明性, 可独立更新

### 修改 trail

- 2026-05-27: 初稿 v0.1 (落地双轨设计 v0.2a Phase B, 见 plan-linked-garden.md)
