import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ImportAggregateForm } from "./ImportAggregateForm";
import { IntakeForm } from "./IntakeForm";

interface NewProductModalProps {
  open: boolean;
  onClose: () => void;
  /** 仅在「录入已有」分支命中时调用,把新落盘的产品 id 通知给父级用于选中。 */
  onCreated: (id: string) => void;
}

type Tab = "new" | "import";
type CopyState = "idle" | "copied" | "error";

const TABS: Array<{ id: Tab; label: string; sub: string }> = [
  { id: "new", label: "新建产品", sub: "按规范立项 · 导入汇总 md" },
  { id: "import", label: "录入已有产品", sub: "项目地址 · 发现 → 访谈 → 沉淀" }
];

export function NewProductModal({ open, onClose, onCreated }: NewProductModalProps) {
  const [tab, setTab] = useState<Tab>("new");
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [copyErr, setCopyErr] = useState<string | null>(null);
  // 预取规范文本,把点击 → 写剪贴板的链路压成同步,避免被浏览器判定为脱离用户手势。
  const [specText, setSpecText] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setCopyState("idle");
      setTab("new");
      setCopyErr(null);
      setSpecText(null);
      return;
    }
    // 模态打开时一次性拉规范;失败也保留 null,点击时再走兜底
    let abort = false;
    void fetch("/api/spec/atlas")
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((text) => {
        if (!abort) setSpecText(text);
      })
      .catch((e) => {
        if (!abort) {
          console.error("[NewProductModal] prefetch spec failed:", e);
        }
      });
    return () => {
      abort = true;
    };
  }, [open]);

  if (!open) return null;

  const writeClipboard = (text: string) => {
    // 优先 navigator.clipboard;失败回落到 execCommand。两个都做同步 try,
    // 真错误用 console.error + UI 文案暴露,不再静默吞。
    try {
      if (navigator.clipboard && window.isSecureContext) {
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopyState("copied");
            setCopyErr(null);
            setTimeout(() => setCopyState("idle"), 2000);
          },
          (err) => {
            console.error("[NewProductModal] clipboard.writeText:", err);
            // navigator.clipboard 失败时尝试 execCommand
            if (!fallbackCopy(text)) {
              setCopyState("error");
              setCopyErr(err?.message ?? "navigator.clipboard 失败");
              setTimeout(() => {
                setCopyState("idle");
                setCopyErr(null);
              }, 4000);
            }
          }
        );
        return;
      }
    } catch (err) {
      console.error("[NewProductModal] clipboard exception:", err);
    }
    if (!fallbackCopy(text)) {
      setCopyState("error");
      setCopyErr("浏览器不支持自动复制");
      setTimeout(() => {
        setCopyState("idle");
        setCopyErr(null);
      }, 4000);
    }
  };

  /** 兜底:用 textarea + execCommand('copy')。返回是否成功。 */
  const fallbackCopy = (text: string): boolean => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) {
        setCopyState("copied");
        setCopyErr(null);
        setTimeout(() => setCopyState("idle"), 2000);
        return true;
      }
      return false;
    } catch (err) {
      console.error("[NewProductModal] execCommand fallback failed:", err);
      return false;
    }
  };

  const handleCopy = () => {
    if (specText) {
      writeClipboard(specText);
      return;
    }
    // 预取还没回来:同步发个 fetch 但不 await(浏览器可能仍允许 clipboard
    // 因为点击手势刚发生)。失败兜底文案。
    setCopyState("idle");
    setCopyErr("规范尚未加载完成,请稍后再试");
    setTimeout(() => setCopyErr(null), 2500);
    void fetch("/api/spec/atlas")
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((text) => setSpecText(text))
      .catch((e) => console.error("[NewProductModal] handleCopy fetch:", e));
  };

  const copyLabel =
    copyState === "copied"
      ? "已复制 ✓"
      : copyState === "error"
        ? `复制失败${copyErr ? ` · ${copyErr}` : ""},可手动打开 ATLAS-SPEC.md`
        : specText
          ? "复制 ATLAS-SPEC.md 规范"
          : "复制 ATLAS-SPEC.md 规范 (加载中…)";

  const copyClass =
    copyState === "error"
      ? "border-rose-300 bg-rose-50 text-rose-700"
      : copyState === "copied"
        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
        : "border-slate-300 bg-white text-slate-700 hover:border-slate-500 hover:text-slate-900";

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="w-full max-w-xl rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-950">新建 / 录入产品</h2>
          <button
            aria-label="关闭"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="border-b border-slate-200 px-5">
          <div className="flex gap-1">
            {TABS.map((t) => {
              const active = t.id === tab;
              return (
                <button
                  className={`relative -mb-px border-b-2 px-3 py-2 text-xs transition ${
                    active
                      ? "border-slate-950 text-slate-950"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  type="button"
                >
                  <span className="font-semibold">{t.label}</span>
                  <span className="ml-1.5 text-[11px] font-normal text-slate-400">{t.sub}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          {tab === "new" ? (
            <ImportAggregateForm
              onCreated={(id) => {
                onCreated(id);
                onClose();
              }}
            />
          ) : (
            <IntakeForm
              onCreated={(item) => {
                onClose();
                navigate(`/intake/${item.id}`);
              }}
            />
          )}

          <div className="border-t border-slate-200 pt-3">
            <button
              className={`w-full rounded border px-3 py-2 text-xs font-medium transition ${copyClass}`}
              onClick={handleCopy}
              type="button"
            >
              {copyLabel}
            </button>
            <p className="mt-1.5 text-[11px] text-slate-500">
              新建产品前,把规范贴给 Codex/Claude,让它按规范生成汇总 md 再拖入上方。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
