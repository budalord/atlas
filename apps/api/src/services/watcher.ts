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
