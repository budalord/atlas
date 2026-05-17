import { useRef, useState } from "react";
import { useProductStore } from "../stores/productStore";

interface ImportAggregateFormProps {
  onCreated: (id: string) => void;
}

/**
 * 拖拽或点选上传单文件汇总 md,调用 POST /api/products/import-aggregate。
 * 始终展开,由外层(如 NewProductModal)控制可见性。
 */
export function ImportAggregateForm({ onCreated }: ImportAggregateFormProps) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fetchAll = useProductStore((s) => s.fetchAll);

  const submit = async (text: string) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/products/import-aggregate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: text })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json();
      const productId: string = body.data?.id;
      await fetchAll();
      onCreated(productId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".md")) {
      setErr("请上传 .md 文件");
      return;
    }
    const text = await file.text();
    await submit(text);
  };

  return (
    <div>
      <div
        className={`rounded border-2 border-dashed px-3 py-8 text-center text-xs transition ${
          dragging
            ? "border-cyan-500 bg-cyan-50 text-cyan-800"
            : "border-slate-300 text-slate-500"
        } ${busy ? "opacity-60" : "cursor-pointer hover:border-slate-500 hover:text-slate-700"}`}
        onClick={() => !busy && fileInputRef.current?.click()}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDrop={async (e) => {
          e.preventDefault();
          setDragging(false);
          if (busy) return;
          const file = e.dataTransfer.files[0];
          if (file) await handleFile(file);
        }}
      >
        {busy ? "导入中..." : "拖拽 .md 文件到此处,或点击选择"}
      </div>
      <input
        accept=".md,text/markdown"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) await handleFile(file);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
        ref={fileInputRef}
        type="file"
      />
      {err ? (
        <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
          {err}
        </div>
      ) : null}
    </div>
  );
}
