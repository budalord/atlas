---
id: payment-management
name: 收付款管理
domain: 财务
value_statement: 财务通过回款/退费记录, 统管学员订单的资金流入流出
actor_ids: [finance, sales, student]
entity_ids: [PaymentRecord, Refund, Order]
priority: P0
status: confirmed
source: user_input
confirmed: true
---
# 收付款管理
## 业务描述
钱进钱出的统一管理。
