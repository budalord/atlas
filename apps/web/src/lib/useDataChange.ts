import { useEffect, useRef } from "react";
import { subscribeDataChange } from "./dataChangeBus";

/**
 * 订阅全局 SSE 总线的 data-change 事件,在数据变更时触发回调。
 *
 * 注意:用 ref 持有最新 handler,避免 inline arrow 造成的 stale closure
 *      (常见症状:依赖某个 prop 的回调,prop 改后回调仍用旧值)。
 *
 * 实现已切换到单例 SSE bus(`dataChangeBus.ts`),避免每个组件各开一条连接。
 */
export function useDataChange(handler: () => void) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => subscribeDataChange(() => ref.current()), []);
}
