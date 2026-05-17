import type { ProductStatus } from "../types";

export interface PrimaryTransition {
  target: ProductStatus;
  label: string;
  /** 是否在按钮上挂「黄牌」(根据 readiness.startDev/goLive 的 ok 字段) */
  readinessKey: "startDev" | "goLive" | null;
}

export interface SecondaryTransition {
  target: ProductStatus;
  label: string;
  /** 是否需要二次确认对话框(归档) */
  requiresDialog: boolean;
}

/**
 * 当前状态下的「主推进按钮」。null 表示该状态没有主推进动作(已上线/归档/暂停 时主按钮空缺)。
 */
export function primaryTransition(from: ProductStatus): PrimaryTransition | null {
  switch (from) {
    case "discovering":
      return { target: "in-progress", label: "开始开发", readinessKey: "startDev" };
    case "planning":
      // 批次 5' 收尾:加重文案 + 在 ProductStatusBar 里给二次确认对话框
      return { target: "in-progress", label: "▶ 推进到开发阶段", readinessKey: "startDev" };
    case "in-progress":
      return { target: "live", label: "标记上线", readinessKey: "goLive" };
    case "paused":
      return { target: "in-progress", label: "恢复开发", readinessKey: null };
    case "live":
    case "archived":
      return null;
  }
}

/**
 * 折叠菜单里的次要动作(暂停/恢复/归档)。归档动作需要二次确认对话框。
 */
export function secondaryTransitions(from: ProductStatus): SecondaryTransition[] {
  const out: SecondaryTransition[] = [];
  switch (from) {
    case "in-progress":
      out.push({ target: "paused", label: "暂停", requiresDialog: false });
      break;
    case "live":
      out.push({ target: "paused", label: "暂停", requiresDialog: false });
      break;
    case "paused":
      // 主按钮已是「恢复开发」,菜单不再重复
      break;
    default:
      break;
  }
  if (from !== "archived") {
    out.push({ target: "archived", label: "归档", requiresDialog: true });
  }
  return out;
}
