---
id: order-creation
name: 订单创建
domain: 招生
value_statement: 销售为学员创建订单, 关联产品与付款
actor_ids: [sales, student]
entity_ids: [Order, Product, PaymentRecord, Student]
priority: P0
status: confirmed
source: user_input
confirmed: true
---
# 订单创建
## 业务描述
学员签单流程, 触发回款。
