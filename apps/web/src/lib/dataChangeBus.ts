/**
 * 全局单例 SSE 总线 — 整页 app 只开 **一条** `/api/events` 连接。
 *
 * Why:浏览器同源 HTTP/1.1 并发上限 6;原来每个 `useDataChange()` 都各开一个
 * EventSource(再叠加 StrictMode dev 双挂载),很容易耗尽连接,导致刷新
 * 间歇性卡在 fetch 排队上("一直转圈")。
 *
 * 用法:
 *   import { subscribeDataChange } from "./dataChangeBus";
 *   useEffect(() => subscribeDataChange((evt) => { ... }), []);
 *
 * 设计:
 * - 第一个订阅者出现时创建 EventSource;订阅清空后**不关闭**(保留给页面
 *   后续组件复用,避免反复开关浪费一个 keep-alive 槽位)。
 * - EventSource 自带浏览器侧的断线自动重连,不用我们管。
 */

export interface DataChangeEvent {
  version: number;
  changedPath?: string;
}

type Listener = (evt: DataChangeEvent) => void;

let source: EventSource | null = null;
const listeners = new Set<Listener>();

function ensureSource() {
  if (source) return;
  // 在 jsdom / 测试环境兜底
  if (typeof EventSource === "undefined") return;
  source = new EventSource("/api/events");
  source.addEventListener("data-change", (e: MessageEvent) => {
    let payload: DataChangeEvent = { version: 0 };
    try {
      payload = JSON.parse(e.data) as DataChangeEvent;
    } catch {
      // ignore parse error,仍然广播一个空 payload 让订阅者知道有变更
    }
    for (const fn of listeners) {
      try {
        fn(payload);
      } catch {
        // 单个订阅者抛错不影响其他人
      }
    }
  });
}

export function subscribeDataChange(fn: Listener): () => void {
  ensureSource();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
