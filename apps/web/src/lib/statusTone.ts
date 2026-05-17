/**
 * 把功能点 / 产品的 status 文本归一化为一个语义类别,用于上色。
 * status 来源是用户写在 markdown 里的字符串,可能含 markdown 标记或括号备注。
 */
export type StatusTone =
  | "live"
  | "doing"
  | "planned"
  | "planning"
  | "blocked"
  | "deprecated"
  | "canceled"
  | "neutral";

interface ToneStyle {
  /** 整个 chip 的 tailwind 类(bg + text + border) */
  chip: string;
  /** 文本色,用于行内文字着色而不要背景 */
  text: string;
}

const TONE_STYLES: Record<StatusTone, ToneStyle> = {
  live: {
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
    text: "text-emerald-700"
  },
  doing: {
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    text: "text-amber-700"
  },
  planned: {
    chip: "border-sky-200 bg-sky-50 text-sky-800",
    text: "text-sky-700"
  },
  planning: {
    chip: "border-indigo-300 bg-indigo-50 text-indigo-800",
    text: "text-indigo-700"
  },
  blocked: {
    chip: "border-rose-200 bg-rose-50 text-rose-800",
    text: "text-rose-700"
  },
  deprecated: {
    chip: "border-slate-300 bg-slate-100 text-slate-600",
    text: "text-slate-500"
  },
  canceled: {
    chip: "border-slate-300 bg-slate-100 text-slate-500 line-through",
    text: "text-slate-500 line-through"
  },
  neutral: {
    chip: "border-slate-200 bg-white text-slate-700",
    text: "text-slate-700"
  }
};

/**
 * 关键词匹配。先剥离 markdown 标记和括号补充。
 */
export function classifyStatus(raw: string | null | undefined): StatusTone {
  if (!raw) return "neutral";
  const s = raw.toLowerCase().replace(/[`*]/g, "").trim();
  if (!s) return "neutral";

  if (/^(live|done|完成|已上线|已实现)/.test(s) || s.includes("live")) return "live";
  if (/^planning$/.test(s) || s.includes("立项")) return "planning";
  if (/^(doing|in[- ]?progress|重构|进行|partial|manual)/.test(s) || s.includes("重构") || s.includes("doing") || s.includes("partial")) return "doing";
  if (/^(blocked|paused|阻塞|暂停)/.test(s)) return "blocked";
  if (/^(planned|todo|计划|待办)/.test(s)) return "planned";
  if (/^(deprecated|废弃|下线)/.test(s)) return "deprecated";
  if (/^(canceled|cancelled|取消)/.test(s)) return "canceled";
  if (/^(archived|归档)/.test(s)) return "deprecated";
  return "neutral";
}

export function statusChipClass(raw: string | null | undefined): string {
  return TONE_STYLES[classifyStatus(raw)].chip;
}

export function statusTextClass(raw: string | null | undefined): string {
  return TONE_STYLES[classifyStatus(raw)].text;
}
