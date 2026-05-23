import { useEffect, useRef, useState } from "react";
import type { FeaturePointPreview } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface FeatureHoverCardProps {
  productId: string;
  moduleId: string;
  preview: FeaturePointPreview;
  /** popover 锚点(节点 client 坐标 — 屏幕坐标系) */
  anchor: { x: number; y: number };
  /** 鼠标移入卡片 → 取消父级的关闭定时器 */
  onMouseEnter: () => void;
  /** 鼠标离开卡片 → 立即关闭 */
  onMouseLeave: () => void;
  /** 写完反馈 / 切已审状态 → 通知父级刷新 markmap */
  onChanged: () => void;
  /** 点"看完整详情"→ 打开 FeatureModal(父级负责) */
  onOpenDetail: () => void;
}

/**
 * markmap 节点 hover 浮卡。决策者审阅闭环的核心交互:
 *   - 默认显示 ## 给决策者 内容(白话视角)
 *   - 快速投反馈(单文本框 → POST /feedback)
 *   - 一键标已审 / 取消已审(PATCH /:fid/review)
 *   - 打开 FeatureModal 看技术细节
 *
 * 定位策略:fixed 定位,锚点是节点的 clientX/Y,放在节点右侧(不够空间则左侧)。
 */
export function FeatureHoverCard({
  productId,
  moduleId,
  preview,
  anchor,
  onMouseEnter,
  onMouseLeave,
  onChanged,
  onOpenDetail
}: FeatureHoverCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: anchor.x + 16,
    top: anchor.y
  });

  // 卡片渲染后测尺寸 + 视口边界回弹,避免被裁切
  useEffect(() => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.x + 16;
    let top = anchor.y;
    if (left + rect.width > vw - 12) {
      // 放节点左侧
      left = Math.max(12, anchor.x - rect.width - 16);
    }
    if (top + rect.height > vh - 12) {
      top = Math.max(12, vh - rect.height - 12);
    }
    setPos({ left, top });
  }, [anchor.x, anchor.y]);

  const submitFeedback = async () => {
    const content = feedbackText.trim();
    if (!content) return;
    setSubmitting(true);
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const rand = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
      const id = `fb-${today}-${rand}`;
      const target = `feature:${moduleId}:${preview.id}`;
      const res = await fetch(`/api/products/${productId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, content, id })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setFeedbackText("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleReview = async () => {
    setReviewSubmitting(true);
    setError(null);
    try {
      const action = preview.reviewed_at ? "unmark" : "mark";
      const res = await fetch(
        `/api/products/${productId}/features/${preview.id}/review`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action })
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setReviewSubmitting(false);
    }
  };

  return (
    <div
      ref={cardRef}
      className="fixed z-40 w-[420px] max-w-[90vw] rounded-lg border border-slate-200 bg-white shadow-2xl"
      style={{ left: pos.left, top: pos.top }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* 顶栏:名称 + 徽章 */}
      <div className="flex items-start justify-between border-b border-slate-200 px-4 py-2.5">
        <div className="flex flex-col gap-1">
          <div className="text-[11px] text-slate-500">{moduleId}</div>
          <div className="text-[14px] font-semibold text-slate-900">{preview.name}</div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {preview.reviewed_at ? (
            <span
              className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800"
              title={`审阅日期: ${preview.reviewed_at}`}
            >
              已审
            </span>
          ) : null}
          {preview.feedbackCount > 0 ? (
            <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
              反馈 {preview.feedbackCount}
            </span>
          ) : null}
          {preview.needs_revision ? (
            <span
              className="rounded border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-800"
              title="frontmatter needs_revision=true · 等 Agent 重做"
            >
              待 Agent
            </span>
          ) : null}
        </div>
      </div>

      {/* 决策者描述 */}
      <div className="border-b border-slate-200 px-4 py-3">
        {preview.decisionMakerView.trim() ? (
          <div className="prose prose-sm max-w-none text-[13px] leading-relaxed text-slate-800">
            <MarkdownRenderer markdown={preview.decisionMakerView} />
          </div>
        ) : (
          <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[12px] italic text-slate-500">
            该功能点尚未填写"给决策者"内容。点"看完整详情"查看技术描述,或直接投反馈让 Agent 补全。
          </div>
        )}
      </div>

      {/* 操作区 */}
      <div className="space-y-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`flex-1 rounded border px-3 py-1.5 text-[12px] font-medium ${
              preview.reviewed_at
                ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                : "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
            } disabled:opacity-50`}
            disabled={reviewSubmitting}
            onClick={toggleReview}
          >
            {reviewSubmitting
              ? "处理中..."
              : preview.reviewed_at
                ? `取消已审 (${preview.reviewed_at})`
                : "标已审"}
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
            onClick={onOpenDetail}
          >
            看完整详情 →
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <textarea
            className="w-full resize-none rounded border border-slate-300 px-2 py-1.5 text-[12px] focus:border-slate-500 focus:outline-none"
            rows={2}
            placeholder="快速投反馈(回车提交,Shift+回车换行)..."
            value={feedbackText}
            disabled={submitting}
            onChange={(e) => setFeedbackText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submitFeedback();
              }
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400">
              反馈池 → Agent 下轮 revise 会读这些反馈
            </span>
            <button
              type="button"
              className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              disabled={!feedbackText.trim() || submitting}
              onClick={() => void submitFeedback()}
            >
              {submitting ? "提交中..." : "+ 投反馈"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
