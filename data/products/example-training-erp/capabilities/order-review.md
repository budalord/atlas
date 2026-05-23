---
id: order-review
name: 订单审核
domain: 财务
value_statement: 财务对销售提交的订单做双字段审核, 把关回款金额
actor_ids: [finance, sales]
entity_ids: [Order]
priority: P0
status: confirmed
source: user_input
confirmed: true
---
# 订单审核
## 业务描述
财务对订单的双字段(应收/已收)审核闭环。
