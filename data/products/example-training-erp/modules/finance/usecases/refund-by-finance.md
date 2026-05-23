---
id: refund-by-finance
function_id: refund-handling
actor_id: finance
precondition: 销售提交退费申请, 财务收到审批通知
postcondition: 退费处理完成 + 学员账户更新 + 通知销售
---
# 财务发起退费

## 主流程
1. 财务收到销售提交的退费申请
2. 审核退费金额合法性
3. 通过支付通道发起退款
4. 标记 Refund 状态为 completed
5. 通知销售退款完成

## 备选流程
- 退费金额超规 → 校长审批
- 支付通道异常 → 走线下转账
