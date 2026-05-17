import type { ProductStatus } from "@atlas/shared";

/**
 * 5-phase 状态机:
 *   立项中(discovering/planning) → 进行中(in-progress) → 已上线(live)
 *                                        ⇅
 *                                     暂停(paused)
 *
 *   任意非 archived 状态 → archived(软归档)。归档后单向,不允许再激活。
 */
const TRANSITIONS: Record<ProductStatus, ProductStatus[]> = {
  discovering: ["in-progress", "archived"],
  planning: ["in-progress", "archived"],
  "in-progress": ["live", "paused", "archived"],
  paused: ["in-progress", "archived"],
  live: ["paused", "archived"],
  archived: []
};

export function allowedTransitions(from: ProductStatus): ProductStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function isAllowed(from: ProductStatus, to: ProductStatus): boolean {
  return allowedTransitions(from).includes(to);
}
