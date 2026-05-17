import { useEffect, useState } from "react";

interface ArchiveProductDialogProps {
  open: boolean;
  productId: string;
  productName: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

/**
 * 归档产品的二次确认模态。需要用户输入产品 id 才能启用「归档」按钮。
 */
export function ArchiveProductDialog({
  open,
  productId,
  productName,
  onConfirm,
  onClose
}: ArchiveProductDialogProps) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTyped("");
      setBusy(false);
      setErr(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canConfirm = typed === productId && !busy;

  const handleConfirm = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "归档失败");
      setBusy(false);
    }
  };

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-950">归档产品</h2>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">
          <p className="text-slate-700">
            将把 <span className="font-semibold">{productName}</span> 移到「归档」分组。文件保留在磁盘,可由命令行或后续 PATCH 恢复。
          </p>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-700">
              输入产品 id <span className="font-mono text-rose-600">{productId}</span> 确认:
            </div>
            <input
              autoFocus
              className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm focus:border-slate-950 focus:outline-none"
              onChange={(e) => setTyped(e.target.value)}
              placeholder={productId}
              value={typed}
            />
          </div>
          {err ? (
            <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">{err}</div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            className="rounded px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="rounded bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-300"
            disabled={!canConfirm}
            onClick={handleConfirm}
            type="button"
          >
            {busy ? "归档中..." : "归档"}
          </button>
        </div>
      </div>
    </div>
  );
}
