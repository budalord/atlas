import chokidar from "chokidar";
import { DATA_ROOT } from "./fileReader";

type ChangeListener = (version: number, changedPath: string) => void;

let dataVersion = 1;
const listeners = new Set<ChangeListener>();

export function getDataVersion() {
  return dataVersion;
}

export function onDataChange(listener: ChangeListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 手动触发一次 data-change 广播。任务队列等非文件源(状态变化)用这个,
 * 让前端通过同一个 SSE 通道感知变化,无需另开端点。
 */
export function bumpDataVersion(changedPath = "synthetic") {
  dataVersion += 1;
  for (const listener of listeners) {
    listener(dataVersion, changedPath);
  }
}

export function startDataWatcher() {
  const watcher = chokidar.watch(DATA_ROOT, {
    ignoreInitial: true,
    persistent: true
  });

  watcher.on("all", (_event, changedPath) => {
    dataVersion += 1;
    for (const listener of listeners) {
      listener(dataVersion, changedPath);
    }
  });

  return watcher;
}
