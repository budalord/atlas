---
id: system-attendance-import
function_id: attendance
actor_id: system
precondition: 学员通过扫码签到, 数据进入 ERP
postcondition: AttendanceRecord 自动落库 + 学员出勤率重算
---
# 系统自动导入考勤

## 主流程
1. 学员到课后扫教室二维码
2. 系统自动写入 AttendanceRecord
3. 触发学员出勤率重算
