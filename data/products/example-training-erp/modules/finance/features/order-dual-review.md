---
id: order-dual-review
name: 订单双字段审核
module: finance
capability_id: order-review
actor_ids: [finance, sales]
entities_touched: [Order]
created_at: 2026-05-23
---
# 订单双字段审核
## 给决策者
财务审核订单的应收/已收双字段, 通过后入库。
## 描述
状态: pending_review → approved / rejected
