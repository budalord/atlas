---
id: online-channel-intake
function_id: student-intake
actor_id: sales
precondition: 学员通过线上渠道(官网/H5)提交报名表单
postcondition: 学员档案落库 + 触发首单创建提示
---
# 线上渠道学员录入

## 主流程
1. 学员在线上渠道提交报名表单
2. 系统识别渠道来源标签
3. 销售在 ERP 看到新线索, 完善学员档案
4. 提交后系统提示创建订单

## 备选流程
- 学员手机号已存在 → 提示销售确认是否同一人
