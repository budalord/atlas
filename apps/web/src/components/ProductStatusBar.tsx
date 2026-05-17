import { useEffect, useRef, useState } from "react";
import { phaseToneClass, PHASE_LABELS, statusToPhase } from "../lib/productPhase";
import {
  primaryTransition,
  secondaryTransitions,
  type PrimaryTransition,
  type SecondaryTransition
} from "../lib/productTransitions";
import { useProductStore } from "../stores/productStore";
import type { Product, ProductStatus } from "../types";
import { ArchiveProductDialog } from "./ArchiveProductDialog";

interface ProductStatusBarProps {
  product: Product;
}

interface ReadinessSection {
  ok: boolean;
  hints: string[];
}

interface Readiness {
  startDev: ReadinessSection;
  goLive: ReadinessSection;
}

export function ProductStatusBar({ product }: ProductStatusBarProps) {
  const patchStatus = useProductStore((s) => s.patchStatus);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const phase = statusToPhase(product.meta.status);
  const primary = primaryTransition(product.meta.status);
  const secondaries = secondaryTransitions(product.meta.status);

  useEffect(() => {
    let abort = false;
    void fetch(`/api/products/${product.id}/readiness`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!abort && body?.data) setReadiness(body.data as Readiness);
      })
      .catch(() => {
        // 静默,黄牌只是提示
      });
    return () => {
      abort = true;
    };
  }, [product.id, product.meta.status]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  const runTransition = async (target: ProductStatus, friendlyLabel: string) => {
    setBusy(true);
    setErr(null);
    try {
      await patchStatus(product.id, target);
      showToast(`已${friendlyLabel}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
      {/* 左:状态 chip + 副标 */}
      <div className="flex items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${phaseToneClass(phase)}`}>
          {PHASE_LABELS[phase]}
        </span>
        <span className="text-xs text-slate-500">
          状态 <span className="font-mono text-slate-700">{product.meta.status}</span>
        </span>
      </div>

      {/* 中:主推进按钮 + 黄牌 */}
      {primary ? (
        <PrimaryButton
          busy={busy}
          onClick={() => {
            // planning → in-progress 是不可逆性较强的状态变更,加二次确认对话框
            if (product.meta.status === "planning" && primary.target === "in-progress") {
              setAdvanceOpen(true);
            } else {
              void runTransition(primary.target, primary.label);
            }
          }}
          readiness={primary.readinessKey ? readiness?.[primary.readinessKey] : null}
          transition={primary}
        />
      ) : (
        <span className="text-xs text-slate-400">
          {product.meta.status === "live" ? "已上线" : product.meta.status === "archived" ? "已归档" : ""}
        </span>
      )}

      {/* 右:折叠菜单 */}
      <div className="relative ml-auto" ref={menuRef}>
        <button
          aria-expanded={menuOpen}
          className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:border-slate-500"
          onClick={() => setMenuOpen((v) => !v)}
          type="button"
        >
          更多 ▾
        </button>
        {menuOpen ? (
          <div className="absolute right-0 top-full mt-1 w-36 rounded-md border border-slate-200 bg-white shadow-lg">
            {secondaries.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">当前状态无可选动作</div>
            ) : (
              secondaries.map((tr) => (
                <SecondaryMenuItem
                  busy={busy}
                  key={tr.target}
                  onActivate={async () => {
                    setMenuOpen(false);
                    if (tr.requiresDialog) {
                      setArchiveOpen(true);
                    } else {
                      await runTransition(tr.target, tr.label);
                    }
                  }}
                  transition={tr}
                />
              ))
            )}
          </div>
        ) : null}
      </div>

      {/* toast / err */}
      {toast ? (
        <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800">{toast}</span>
      ) : null}
      {err ? (
        <span className="rounded bg-rose-100 px-2 py-0.5 text-[11px] text-rose-800" title={err}>
          {err}
        </span>
      ) : null}

      <ArchiveProductDialog
        onClose={() => setArchiveOpen(false)}
        onConfirm={() => runTransition("archived", "归档")}
        open={archiveOpen}
        productId={product.id}
        productName={product.meta.name}
      />
      {advanceOpen ? (
        <AdvanceConfirmDialog
          busy={busy}
          onCancel={() => setAdvanceOpen(false)}
          onConfirm={async () => {
            setAdvanceOpen(false);
            await runTransition("in-progress", "推进到开发阶段");
          }}
          productName={product.meta.name}
        />
      ) : null}
    </div>
  );
}

function AdvanceConfirmDialog({
  productName,
  busy,
  onConfirm,
  onCancel
}: {
  productName: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-[460px] rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">推进到开发阶段</h2>
        </header>
        <div className="space-y-3 px-5 py-4 text-sm leading-6 text-slate-700">
          <p>
            确认推进 <span className="font-semibold">{productName}</span> 到开发阶段?
          </p>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-600">
            <li>状态从 <code className="font-mono">planning</code> 变为 <code className="font-mono">in-progress</code></li>
            <li>立项阶段隐藏的线索池将恢复显示</li>
            <li>Codex refine 等开发期能力恢复</li>
            <li>此操作可逆(可手动改回 planning)</li>
          </ul>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            className="rounded px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="rounded bg-slate-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? "处理中..." : "▶ 推进"}
          </button>
        </footer>
      </div>
    </div>
  );
}

interface PrimaryButtonProps {
  transition: PrimaryTransition;
  readiness: ReadinessSection | null | undefined;
  busy: boolean;
  onClick: () => void;
}

function PrimaryButton({ transition, readiness, busy, onClick }: PrimaryButtonProps) {
  const showWarn = readiness && !readiness.ok && readiness.hints.length > 0;
  const tooltip = showWarn ? `建议在推进前处理:\n${readiness.hints.map((h) => "• " + h).join("\n")}` : "";

  return (
    <button
      className="relative inline-flex items-center gap-1.5 rounded-md bg-slate-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
      disabled={busy}
      onClick={onClick}
      title={tooltip}
      type="button"
    >
      {busy ? "处理中..." : transition.label}
      {showWarn ? (
        <span
          aria-label="有就绪度警告"
          className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-white bg-amber-400"
        />
      ) : null}
    </button>
  );
}

interface SecondaryMenuItemProps {
  transition: SecondaryTransition;
  busy: boolean;
  onActivate: () => void;
}

function SecondaryMenuItem({ transition, busy, onActivate }: SecondaryMenuItemProps) {
  const isDanger = transition.target === "archived";
  return (
    <button
      className={`flex w-full items-center px-3 py-2 text-left text-xs hover:bg-slate-50 ${
        isDanger ? "text-rose-700" : "text-slate-700"
      } disabled:opacity-50`}
      disabled={busy}
      onClick={onActivate}
      type="button"
    >
      {transition.label}
    </button>
  );
}
