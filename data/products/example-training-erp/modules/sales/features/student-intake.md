---
id: student-intake
name: 学员录入
module: sales
capability_id: student-intake
actor_ids: [sales]
entities_touched: [Student, Lead]
created_at: 2026-05-23
---
# 学员录入
## 给决策者
销售把线索学员转为正式学员档案。
## 描述
**关键字段**: name / phone / lead_source
**关键约束**: phone unique
**触发后续**: order-creation
