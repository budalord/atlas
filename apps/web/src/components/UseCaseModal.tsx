import { useCallback, useEffect, useState } from "react";
import type { ApiEnvelope, UseCase } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface UseCaseModalProps {
  productId: string;
  functionId: string;
  usecaseId: string;
  module: string;
  onClose: () => void;
}

/**
 * UseCase 弹窗 — 点 markmap usecase 叶节点弹此。
 *
 * v0.1 rev3 五层骨架最底层 — function 的可选子层。
 * 展示: function_id / actor_id / precondition / postcondition + body 的 ## 主流程 / ## 备选流程 / ## 备注
 */
export function UseCaseModal({
  productId,
  functionId,
  usecaseId,
  module,
  onClose
}: UseCaseModalProps) {
  const [uc, setUc] = useState<UseCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}/usecases/${functionId}/${usecaseId}`);
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(`usecase 不存在: ${functionId}/${usecaseId}`);
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as ApiEnvelope<UseCase>;
      setUc(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [productId, functionId, usecaseId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-[70vw] max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700">
                UseCase
              </span>
              <span>module: {module}</span>
              <span className="text-slate-300">›</span>
              <span>function: {functionId}</span>
            </div>
            <h2 className="text-xl font-semibold text-slate-900">{uc?.id ?? usecaseId}</h2>
          </div>
          <button
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
            type="button"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="py-10 text-center text-xs text-slate-500">加载中...</div>
          ) : error ? (
            <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : uc ? (
            <div className="space-y-4">
              {/* meta */}
              <section className="rounded-md border border-emerald-200 bg-emerald-50/40 px-4 py-3">
                <div className="text-[10px] font-medium text-emerald-800">UseCase 元信息</div>
                <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-2">
                  <Meta label="主参与者 (actor)" value={uc.actor_id} mono />
                  <Meta
                    label="操作实体"
                    value={
                      uc.entity_ids && uc.entity_ids.length > 0
                        ? uc.entity_ids.join(" · ")
                        : "(继承自 function)"
                    }
                  />
                  {uc.precondition ? <Meta label="前置条件" value={uc.precondition} fullWidth /> : null}
                  {uc.postcondition ? (
                    <Meta label="后置条件" value={uc.postcondition} fullWidth />
                  ) : null}
                </dl>
              </section>

              {/* 主流程 / 备选流程 / 备注 */}
              <section className="rounded-md border border-slate-200 bg-white px-4 py-3">
                <MarkdownRenderer markdown={uc.body} />
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Meta({
  label,
  value,
  mono,
  fullWidth
}: {
  label: string;
  value: string;
  mono?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? "sm:col-span-2" : ""}>
      <dt className="text-[10px] text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-slate-900 ${mono ? "font-mono text-[11px]" : ""}`}>{value}</dd>
    </div>
  );
}
