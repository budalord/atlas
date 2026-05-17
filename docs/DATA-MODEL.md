# Atlas Data Model

数据模型权威源。如果代码与文档不一致,**以代码为准**;请在发现不一致时同步更新本文档。

类型实现位于 `packages/shared/src/types.ts` 与 `packages/shared/src/feedback.ts`。

## products/<id>/meta.yml

```yaml
id: erp
name: ERP 主体
theme: erp
status: in-progress
tech_stack: [Go, PostgreSQL, React]
source_path: /Users/.../erp
deploy_url: null
created_at: 2026-04-01
tagline: ERP 主体可选 tagline
repo: owner/repo                # 可选,启用 GitHub 集成
description: 可选,新建产品时填
```

字段约定:

- `id`: 产品目录名,必须唯一。
- `theme`: `seo` / `erp` / `miniapp` / `tool`。
- `status`: `discovering` / `planning` / `in-progress` / `paused` / `live` / `archived`。
- `tech_stack`: 字符串数组。
- `deploy_url`: 没有时写 `null`。
- `tagline` / `repo` / `description`: 可选。

> Round 3 移除了 `intake_substage` 字段(原三阶段立项 UI 被砍掉)。如发现历史 meta.yml 仍含该字段,可手动删除。

## products/<id>/STATUS.md

```markdown
---
last_updated: 2026-04-29
---

# 当前状态

简述

## 待办
- [ ] 任务1

## 阻塞
- 无

## 功能点

| ID | 描述 | 状态 | 优先级 | 接口 | 备注 |
|----|------|------|--------|------|------|
| F1 | xxx | done | P0 | POST /xxx | |

## 流程图

```mermaid
flowchart LR
  A --> B
```
```

老产品走 STATUS.md 6 列表;新产品走 modules/features 树。两套结构并存。

## products/<id>/modules/<m>/features/<f>.md(Round 3)

```yaml
---
id: student-intake
name: 学员录入
module: sales
created_at: 2026-05-15
last_refined_at: null
needs_revision: true              # optional
---
```

正文 sections: `# <name>` → `## 描述` → `## 线索池` (Pending/Resolved) → `## 反馈池` → `## 修订记录`。

详见 `ATLAS-SPEC.md` 的"功能点文件格式"段。

## products/<id>/entities/<e>.md / modules/<m>/entities/<e>.md

```yaml
---
added_in_phase: planning
added_at: 2026-05-15
needs_revision: false             # optional
---
```

正文 sections: `# <name>` → `## 字段`(5 列表) → `## 关系` → `## 决策` → `## 反馈池` → `## 修订记录`。

`entityParser.ts` 解析字段表里的 `[TBD]` 标记和 `## 决策` 段;Round 3 删除了 TBD/决策的聚合 tab,但解析能力保留,数据层不动。

## packages/shared/src/feedback.ts

```ts
// 对象级反馈(挂在 feature.md / entity.md 末尾)
export interface Feedback {
  id: string;        // fb-<YYYYMMDD>-<6位 base36>
  date: string;      // YYYY-MM-DD
  content: string;
}

// 全局需求池条目(挂在 GLOBAL-FEEDBACK.md)
export type GlobalFeedbackScope = "feature" | "entity" | "prototype";

export interface GlobalFeedback {
  id: string;        // gfb-<YYYYMMDD>-<6位 base36>
  date: string;
  scope: GlobalFeedbackScope;
  content: string;
}

export interface GlobalFeedbackData {
  feature: GlobalFeedback[];
  entity: GlobalFeedback[];
  prototype: GlobalFeedback[];
}
```

精简后只保留 3 字段(Round 1' 砍掉了 `type / status / source / decision_note / acceptance_scope / decided_at`)。yaml 容错读取:遇到旧字段直接忽略,不报错。

## packages/shared/src/types.ts(Round 3 关键差异)

### ProductMeta
- 移除 `intake_substage`(已删)。
- 新增 `description?: string`(新建产品用)。

### FeaturePoint
```ts
export interface FeaturePoint {
  // ... 既有字段
  spec_level?: number;             // 容错读取,本轮不强用
  feedback?: Feedback[];           // ## 反馈池 解析结果
  needs_revision?: boolean;        // frontmatter 同名字段的快照
  revision_log?: string[];         // ## 修订记录 段每一行,parser 只读不写
}
```

### EntitySpec
同 FeaturePoint 新增 `feedback / needs_revision / revision_log` 三字段。

### FeaturePointPreview
```ts
export interface FeaturePointPreview {
  // ... 既有字段
  feedbackCount: number;           // markmap ⚠ 用
  needs_revision: boolean;         // markmap ⚠ 用
}
```

## CONVENTIONS.md(L0 规范)

文件级数据,不映射到 TypeScript 类型(Atlas 只读不解析结构,Markdown 整段渲染)。后端 GET `/api/products/:id/conventions` 返回:

```ts
{ exists: boolean; content?: string; last_updated?: string | null; }
```

frontmatter 建议:
```yaml
spec_level: 0
version: 1
last_updated: 2026-05-15
```

文件不存在不报 404,返回 `{exists: false}`。

## contracts/<id>.md

```markdown
---
provider: erp
consumers: [miniapp-enrollment, miniapp-thesis]
status: stable
---

# 接口名称

## 端点
POST /api/leads

## 请求字段
...

## 响应字段
...

## 引用方
- miniapp-enrollment 的 F2 功能点
```

## 已退场的聚合类型(保留供未来恢复)

`TBDItem` 和 `DecisionRecord` 类型在 `packages/shared/src/types.ts` 仍然存在,Round 3 删除了对应的聚合端点(`GET /tbd-items` / `GET /decisions`)和聚合 tab。entity.md 文件里的 `## 决策` 段和 `[TBD]` 标记继续由 `entityParser.ts` 解析,数据未删,未来若恢复聚合视图可直接复用。
