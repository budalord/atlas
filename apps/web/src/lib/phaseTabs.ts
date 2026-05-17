import type { ProductPhase } from "./productPhase";

export type TabKey =
  | "features"
  | "overview"
  | "entities"
  | "conventions"
  | "design";

export type TabMode = "read-write" | "read-only";

/**
 * 每个 phase 下出现的 tab + 模式。
 *
 * 设计原则:
 * - 立项中:全部读写。
 * - 进行中:仍读写,但 UI 在追加项上挂 banner(由组件根据 added_in_phase 自行判断)。
 * - 已上线:全部只读;改动通过「💬 提 issue」走 GitHub 流。
 * - 暂停:只读,与 live 一致(冷却中)。
 * - 归档:仅保留概览/功能点的只读视图;实体/L0 规范/双轨设计 整组隐藏。
 *
 * 注:开发看板(AgentTasksPanel)和 git 区块由 ProductDetail 单独按 phase 渲染,不在 tab 集合里。
 */
const TABS_BY_PHASE: Record<ProductPhase, Array<{ key: TabKey; mode: TabMode }>> = {
  planning: [
    { key: "overview", mode: "read-write" },
    { key: "features", mode: "read-write" },
    { key: "entities", mode: "read-write" },
    { key: "conventions", mode: "read-write" },
    { key: "design", mode: "read-write" }
  ],
  "in-progress": [
    { key: "overview", mode: "read-write" },
    { key: "features", mode: "read-write" },
    { key: "entities", mode: "read-write" },
    { key: "conventions", mode: "read-write" },
    { key: "design", mode: "read-only" }
  ],
  live: [
    { key: "overview", mode: "read-only" },
    { key: "features", mode: "read-only" },
    { key: "entities", mode: "read-only" },
    { key: "conventions", mode: "read-only" },
    { key: "design", mode: "read-only" }
  ],
  paused: [
    { key: "overview", mode: "read-only" },
    { key: "features", mode: "read-only" },
    { key: "entities", mode: "read-only" },
    { key: "conventions", mode: "read-only" }
  ],
  archived: [
    { key: "overview", mode: "read-only" },
    { key: "features", mode: "read-only" }
  ]
};

export const TAB_LABELS: Record<TabKey, string> = {
  features: "功能点",
  overview: "概览",
  entities: "实体",
  conventions: "L0 规范",
  design: "双轨设计"
};

export function tabsForPhase(phase: ProductPhase): Array<{ key: TabKey; mode: TabMode }> {
  return TABS_BY_PHASE[phase];
}
