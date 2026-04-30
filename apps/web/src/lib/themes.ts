import type { ProductTheme } from "../types";

type KnownTheme = ProductTheme;
type ThemeKey = KnownTheme | "other";

export const THEME_ORDER: ThemeKey[] = ["erp", "miniapp", "seo", "tool", "other"];

export const THEME_LABELS: Record<ThemeKey, string> = {
  erp: "ERP 主体",
  miniapp: "小程序",
  seo: "SEO 站点",
  tool: "工具",
  other: "其他"
};

export function resolveThemeKey(theme: string): ThemeKey {
  return (THEME_ORDER as string[]).includes(theme) ? (theme as ThemeKey) : "other";
}
