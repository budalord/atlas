/**
 * 立项期产品的最小骨架 STATUS.md (六段空标题 + 6 列功能点表头空表)。
 *
 * 复用于 POST /api/products/blank 和 aggregate importer。
 */
export function blankStatusMarkdown(today: string): string {
  return `---
last_updated: ${today}
---

# 当前状态

立项中。

## 待办

## 阻塞

## 功能点
| ID | 描述 | 状态 | 优先级 | 接口 | 备注 |
| --- | --- | --- | --- | --- | --- |

## 流程图
`;
}
