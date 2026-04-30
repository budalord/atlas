# Atlas Data Model

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
```

字段约定:

- `id`: 产品目录名，必须唯一。
- `theme`: `seo` / `erp` / `miniapp` / `tool`。
- `status`: `in-progress` / `paused` / `live` / `archived`。
- `tech_stack`: 字符串数组。
- `deploy_url`: 没有时写 `null`。

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
