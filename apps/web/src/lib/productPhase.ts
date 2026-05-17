import type { ProductStatus } from "../types";

export type ProductPhase = "in-progress" | "live" | "planning" | "paused" | "archived";

export const PHASE_ORDER: ProductPhase[] = ["in-progress", "live", "planning", "paused", "archived"];

export const PHASE_LABELS: Record<ProductPhase, string> = {
  "in-progress": "进行中",
  live: "已上线",
  planning: "立项中",
  paused: "暂停",
  archived: "归档"
};

export const PHASE_DEFAULT_COLLAPSED: Record<ProductPhase, boolean> = {
  "in-progress": false,
  live: false,
  planning: true,
  paused: false,
  archived: true
};

const PHASE_TONE_CLASS: Record<ProductPhase, string> = {
  "in-progress": "bg-amber-100 text-amber-800",
  live: "bg-emerald-100 text-emerald-800",
  planning: "bg-indigo-100 text-indigo-800",
  paused: "bg-rose-100 text-rose-800",
  archived: "bg-slate-200 text-slate-600"
};

export function statusToPhase(status: ProductStatus | string | null | undefined): ProductPhase {
  if (status === "discovering" || status === "planning") return "planning";
  if (status === "live") return "live";
  if (status === "paused") return "paused";
  if (status === "archived") return "archived";
  return "in-progress";
}

export function phaseToneClass(phase: ProductPhase): string {
  return PHASE_TONE_CLASS[phase];
}
