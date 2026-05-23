# Atlas Matrix 视图渲染契约

> 这份文档钉 **MatrixTab 三矩阵的单元格颜色编码 + 排序 + 过滤行为**, 保证前后端 / 多人开发理解一致。
>
> 范围: Actor × Capability / Actor × Entity / Capability × Entity 三个矩阵。

---

## 1. 三矩阵的语义

### 1.1 Actor × Capability

- 行: Actor
- 列: Capability
- 问题: "谁能调用什么能力"

### 1.2 Actor × Entity

- 行: Actor
- 列: Entity
- 问题: "谁能操作什么数据" (导出即权限设计基础)

### 1.3 Capability × Entity

- 行: Capability
- 列: Entity
- 问题: "什么能力涉及什么数据"

---

## 2. 单元格颜色编码规则 (规则 9)

| 关联级别 | 颜色 (Tailwind) | 判定 |
|---------|-----------------|------|
| **主要** | `bg-emerald-600 text-white` | actor 在 capability.actor_ids (直接声明) |
| **偶尔** | `bg-emerald-100 text-emerald-900` | actor 不在 capability.actor_ids, 但出现在该 capability 某个 function.actor_ids 或 usecase.actor_id 里 (通过 function/usecase 间接) |
| **无关** | `bg-slate-50 text-slate-300` | 都不在 (灰色) |

### 2.1 Actor × Capability 判定细节

```
main(actor A, capability C) := A.id ∈ C.actor_ids
occasional(A, C) := !main(A, C) ∧ (∃ f ∈ functions(C): A.id ∈ f.actor_ids ∨ ∃ u ∈ usecases(f): u.actor_id == A.id)
unrelated(A, C) := !main(A, C) ∧ !occasional(A, C)
```

### 2.2 Actor × Entity 判定细节

```
main(actor A, entity E) := ∃ capability C: A.id ∈ C.actor_ids ∧ E ∈ C.entity_ids
occasional(A, E) := !main(A, E) ∧ ∃ function f: A.id ∈ f.actor_ids ∧ E ∈ f.entities_touched
unrelated(A, E) := !main(A, E) ∧ !occasional(A, E)
```

### 2.3 Capability × Entity 判定细节

```
main(C, E) := E ∈ C.entity_ids
occasional(C, E) := !main(C, E) ∧ ∃ f ∈ functions(C): E ∈ f.entities_touched
unrelated(C, E) := !main(C, E) ∧ !occasional(C, E)
```

---

## 3. 默认密度过滤

为避免"第一眼全浅灰看不出结构"的问题:

- **过滤开关**: "只显示有关联的行/列" — **默认开启**
- 开启时:
  - 行: 至少有 1 个非"无关"单元格的行才显示
  - 列: 至少有 1 个非"无关"单元格的列才显示
- 关闭时: 显示完整矩阵 (含全"无关"行/列)

---

## 4. 默认排序

为让活跃 actor / 高曝光 capability 排在前面:

- **行排序**: 按行内"主要 + 偶尔" 总数降序
- **列排序**: 同上

平局时按 id alphabetical。

用户可手动改排序 (按 id / 按 name / 按关联数), UI 提供切换按钮。

---

## 5. 单元格交互

- **hover**: 显示 tooltip "该 capability 涉及的 function 列表" (主要 / 偶尔 都显示)
- **点击**: 弹浮窗显示该单元格涉及的 function 列表 + usecase 列表 + 链接跳转

---

## 6. 性能预算

- yunkai-erp 预期规模: 11 actor × 35 capability = 385 单元格, 即使全展开也 < 1ms 渲染
- 数据量 < 1000 单元格时不引入虚拟滚动 / lazy render
- 数据量 > 1000 时, 矩阵改为按行 lazy

---

## 7. 修改流程

- 改 §2 颜色规则 → 必须同步改 [apps/web/src/components/tabs/MatrixTab.tsx](apps/web/src/components/tabs/MatrixTab.tsx)
- 改 §3 / §4 默认行为 → 同上
- §5 / §6 是说明性, 可独立更新

### 修改 trail

- 2026-05-23: 初稿 v0.1 (rev3 五层骨架重构, 见 plan-generic-elephant.md)
