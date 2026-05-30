import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiEnvelope, Screen, ScreenSummary, ScreenValidationIssue } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { useDataChange } from "../lib/useDataChange";

interface ScreenListProps {
  productId: string;
  readOnly?: boolean;
}

type DetailedScreen = Screen & { validation_issues?: ScreenValidationIssue[] };
type ScreenRow = ScreenSummary & { needs_prototype?: boolean; pending_prototype?: string };

/**
 * 双轨设计 · Screen 子视图(v0.1)。
 *
 * 左侧按 module 分组列出 screens, 右侧渲染 markdown + validation issues + 反馈池操作。
 * 生成/更新 screen 由「双轨设计」tab 头部的「生成屏幕 / 更新屏幕」agent batch 按钮触发。
 *
 * 不在此处做 inline 编辑(v0.1 范围: agent 写盘, UI 只读 + 反馈)。
 */
export function ScreenList({ productId, readOnly = false }: ScreenListProps) {
  const [list, setList] = useState<ScreenRow[]>([]);
  const [selected, setSelected] = useState<{ module: string; id: string } | null>(null);
  const [detail, setDetail] = useState<DetailedScreen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackInput, setFeedbackInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productId}/screens`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiEnvelope<Screen[]>;
      const summaries: ScreenRow[] = json.data.map((s) => ({
        id: s.id,
        name: s.name,
        module: s.module,
        usecase_ids: s.usecase_ids,
        needs_revision: s.needs_revision,
        needs_prototype: s.needs_prototype,
        pending_prototype: s.pending_prototype
      }));
      setList(summaries);
      setError(null);
      if (selected === null && summaries.length > 0) {
        setSelected({ module: summaries[0].module, id: summaries[0].id });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载 screens 失败");
    }
  }, [productId, selected]);

  const loadDetail = useCallback(
    async (mod: string, id: string) => {
      try {
        const res = await fetch(`/api/products/${productId}/screens/${mod}/${id}`);
        if (res.status === 404) {
          setDetail(null);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ApiEnvelope<DetailedScreen>;
        setDetail(json.data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载 screen 失败");
      }
    },
    [productId]
  );

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  useEffect(() => {
    if (selected) void loadDetail(selected.module, selected.id);
    else setDetail(null);
  }, [selected, loadDetail]);

  useDataChange(() => {
    void loadList();
    if (selected) void loadDetail(selected.module, selected.id);
  });

  const grouped = useMemo(() => {
    const map = new Map<string, ScreenRow[]>();
    for (const s of list) {
      const arr = map.get(s.module) ?? [];
      arr.push(s);
      map.set(s.module, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [list]);

  const target = detail ? `screen:${detail.module}:${detail.id}` : null;

  // 反馈写入: screen 的 feedback target 走 feedback API 的 "screen:<m>:<id>" 形式
  // 注: feedbackWriter 当前只支持 feature/entity/usecase 三种 target;
  //     screen 反馈池写入路径同 usecase, 需要 feedbackWriter 加 screen target 支持。
  //     v0.1 范围内: agent 自己 Edit/Write screen.md 时直接改 ## 反馈池 段, UI 这边按钮先禁用并提示。

  const submitFeedback = async () => {
    if (!target) return;
    const content = feedbackInput.trim();
    if (!content) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, content })
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setFeedbackInput("");
      if (selected) await loadDetail(selected.module, selected.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交反馈失败");
    } finally {
      setBusy(false);
    }
  };

  // 原型图轨: 把该屏标入出图队列(needs_prototype), 由 codex 客户端 drain 会话出图回传。
  const requestPrototype = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/products/${productId}/screens/${selected.module}/${selected.id}/request-prototype`,
        { method: "POST" }
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      await loadDetail(selected.module, selected.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求原型图失败");
    } finally {
      setBusy(false);
    }
  };

  // 审核闸: 通过(暂存图升为 preview_image)/ 打回(丢弃暂存图, 默认重新入队再出)
  const reviewPrototype = async (action: "approve" | "reject") => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/products/${productId}/screens/${selected.module}/${selected.id}/${action}-prototype`,
        action === "reject"
          ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requeue: true }) }
          : { method: "POST" }
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      await loadDetail(selected.module, selected.id);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "审核操作失败");
    } finally {
      setBusy(false);
    }
  };

  // 爆发期: 把所有无图/未入队的屏批量入队出图
  const queueAllMissing = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}/screens/queue-all-missing`, { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as ApiEnvelope<{ count: number }>;
      await loadList();
      if (selected) await loadDetail(selected.module, selected.id);
      setError(json.data.count === 0 ? "没有需要入队的屏(都已有图或在队列中)" : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "批量入队失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-0 grid-cols-[280px_1fr]">
      <aside className="border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
          <div className="text-xs font-medium text-slate-500">界面屏 Screens</div>
          <div className="mt-0.5 text-[10px] text-slate-400">
            共 {list.length} 个 · 按 module 分组
          </div>
          {list.some((r) => r.pending_prototype) ? (
            <div className="mt-0.5 text-[10px] font-medium text-violet-600">
              待审原型 {list.filter((r) => r.pending_prototype).length}
            </div>
          ) : null}
          {!readOnly ? (
            <button
              className="mt-1.5 w-full rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              disabled={busy}
              onClick={() => void queueAllMissing()}
              type="button"
            >
              批量为无图屏出图
            </button>
          ) : null}
        </div>
        {grouped.length === 0 ? (
          <div className="px-4 py-6 text-xs text-slate-400">
            该产品暂无界面屏。用上方「生成界面规格」让 agent 从用例反推。
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {grouped.map(([mod, screens]) => (
              <li key={mod} className="px-4 py-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  {mod}
                </div>
                <ul className="mt-1 space-y-0.5">
                  {screens.map((s) => {
                    const active = selected?.module === s.module && selected?.id === s.id;
                    return (
                      <li key={s.id}>
                        <button
                          className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-[12px] transition ${
                            active
                              ? "bg-slate-900 text-white"
                              : "text-slate-800 hover:bg-slate-100"
                          }`}
                          onClick={() => setSelected({ module: s.module, id: s.id })}
                          type="button"
                        >
                          <span className="truncate">{s.name}</span>
                          <span className="flex shrink-0 items-center gap-1">
                            {s.pending_prototype ? (
                              <span
                                className={`rounded px-1 text-[10px] ${
                                  active ? "bg-violet-300 text-violet-900" : "bg-violet-100 text-violet-800"
                                }`}
                              >
                                审
                              </span>
                            ) : s.needs_prototype ? (
                              <span
                                className={`rounded px-1 text-[10px] ${
                                  active ? "bg-sky-300 text-sky-900" : "bg-sky-100 text-sky-800"
                                }`}
                              >
                                图
                              </span>
                            ) : null}
                            {s.needs_revision ? (
                              <span
                                className={`rounded px-1 text-[10px] ${
                                  active ? "bg-amber-300 text-amber-900" : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                !
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="min-h-0 overflow-auto">
        {error ? (
          <div className="m-5 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {detail ? (
          <div className="space-y-4 p-5">
            <header className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700">
                    Screen
                  </span>
                  <span className="font-mono">{detail.module}/{detail.id}</span>
                </div>
                <h2 className="mt-1 text-xl font-semibold text-slate-900">{detail.name}</h2>
                <div className="mt-1 text-[11px] text-slate-500">
                  承接 usecase: {detail.usecase_ids.join(" · ")}
                </div>
              </div>
              {!readOnly ? (
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button
                    className="rounded bg-indigo-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                    disabled={busy || detail.needs_prototype || !!detail.pending_prototype}
                    onClick={() => void requestPrototype()}
                    type="button"
                  >
                    {detail.preview_image ? "重新出图" : "请求原型图"}
                  </button>
                  {detail.needs_prototype ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
                      待出图队列中 · 等 codex 客户端出图
                    </span>
                  ) : detail.pending_prototype ? (
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-800">
                      待审核
                    </span>
                  ) : null}
                </div>
              ) : null}
            </header>

            {/* 待审暂存图 — 审核闸: 通过才升为 preview_image */}
            {detail.pending_prototype ? (
              <section className="rounded-md border border-violet-300 bg-violet-50/40 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold text-violet-800">
                    待审核原型图 — codex 刚出,通过才生效
                  </div>
                  {!readOnly ? (
                    <div className="flex gap-2">
                      <button
                        className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void reviewPrototype("approve")}
                        type="button"
                      >
                        通过
                      </button>
                      <button
                        className="rounded bg-rose-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void reviewPrototype("reject")}
                        type="button"
                      >
                        打回重出
                      </button>
                    </div>
                  ) : null}
                </div>
                <img
                  className="mt-2 max-h-[480px] w-auto cursor-zoom-in rounded border border-violet-200"
                  src={`/api/products/${productId}/screens/${detail.module}/${detail.id}/pending-image?v=${encodeURIComponent(detail.pending_prototype)}`}
                  alt={`${detail.name} 待审原型图`}
                  title="点击查看高清大图"
                  onClick={() =>
                    setLightbox(
                      `/api/products/${productId}/screens/${detail.module}/${detail.id}/pending-image?v=${encodeURIComponent(detail.pending_prototype as string)}`
                    )
                  }
                />
                <div className="mt-1 break-all text-[10px] text-slate-400">{detail.pending_prototype}</div>
              </section>
            ) : null}

            {/* 已通过的原型图 */}
            {detail.preview_image ? (
              <section className="rounded-md border border-slate-200 bg-white px-4 py-3">
                <div className="text-[10px] font-medium text-slate-500">
                  {detail.pending_prototype ? "当前已通过(通过上面的新图后将被替换)" : "原型图(已通过)"}
                </div>
                <img
                  className="mt-2 max-h-[480px] w-auto cursor-zoom-in rounded border border-slate-200"
                  src={`/api/products/${productId}/screens/${detail.module}/${detail.id}/preview-image?v=${encodeURIComponent(detail.preview_image)}`}
                  alt={`${detail.name} 原型图`}
                  title="点击查看高清大图"
                  onClick={() =>
                    setLightbox(
                      `/api/products/${productId}/screens/${detail.module}/${detail.id}/preview-image?v=${encodeURIComponent(detail.preview_image as string)}`
                    )
                  }
                />
                <div className="mt-1 break-all text-[10px] text-slate-400">{detail.preview_image}</div>
              </section>
            ) : null}

            {/* validation issues */}
            {detail.validation_issues && detail.validation_issues.length > 0 ? (
              <section className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
                <div className="text-[11px] font-semibold text-rose-800">
                  校验问题 ({detail.validation_issues.length})
                </div>
                <ul className="mt-2 space-y-1 text-[12px]">
                  {detail.validation_issues.map((iss, idx) => (
                    <li key={idx} className="text-rose-900">
                      <span
                        className={`mr-1.5 rounded px-1 text-[10px] font-medium ${
                          iss.level === "error"
                            ? "bg-rose-200 text-rose-900"
                            : "bg-amber-200 text-amber-900"
                        }`}
                      >
                        {iss.level}
                      </span>
                      [{iss.rule}] {iss.detail}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* entity_visibility 矩阵速览 */}
            <section className="rounded-md border border-emerald-200 bg-emerald-50/40 px-4 py-3">
              <div className="text-[10px] font-medium text-emerald-800">字段可见性矩阵</div>
              <div className="mt-2 space-y-2">
                {Object.entries(detail.entity_visibility).map(([entityName, vis]) => (
                  <div key={entityName}>
                    <div className="text-[12px] font-semibold text-slate-900">{entityName}</div>
                    <div className="mt-0.5 text-[11px] text-slate-700">
                      <span className="text-slate-500">default:</span> {vis.default.join(", ") || "(空)"}
                    </div>
                    {vis.role_gated
                      ? Object.entries(vis.role_gated).map(([role, fields]) => (
                          <div key={role} className="mt-0.5 text-[11px] text-slate-700">
                            <span className="text-slate-500">role_gated.{role}:</span>{" "}
                            {fields.join(", ")}
                          </div>
                        ))
                      : null}
                    {vis.derived_fields && vis.derived_fields.length > 0 ? (
                      <div className="mt-0.5 text-[11px] text-slate-700">
                        <span className="text-slate-500">derived_fields:</span>{" "}
                        {vis.derived_fields.join(", ")}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

            {/* body */}
            <section className="rounded-md border border-slate-200 bg-white px-4 py-3">
              <MarkdownRenderer markdown={detail.body} />
            </section>

            {/* 反馈池 */}
            {!readOnly ? (
              <section className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold text-slate-700">
                  反馈池({detail.feedback?.length ?? 0} 条)
                </div>
                {detail.feedback && detail.feedback.length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {detail.feedback.map((fb) => (
                      <li
                        key={fb.id}
                        className="rounded border border-slate-200 bg-white px-3 py-2 text-[12px]"
                      >
                        <div className="text-[10px] text-slate-500">
                          <span className="font-mono">{fb.id}</span> · {fb.date}
                        </div>
                        <div className="mt-0.5 whitespace-pre-wrap text-slate-800">
                          {fb.content}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-3 flex items-start gap-2">
                  <textarea
                    className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-[12px] focus:border-slate-500 focus:outline-none"
                    placeholder="记一条业务反馈(下次 agent revise 时会处理)"
                    rows={2}
                    value={feedbackInput}
                    onChange={(e) => setFeedbackInput(e.target.value)}
                  />
                  <button
                    className="shrink-0 rounded bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    disabled={busy || feedbackInput.trim().length === 0}
                    onClick={() => void submitFeedback()}
                    type="button"
                  >
                    记反馈
                  </button>
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="p-10 text-center text-sm text-slate-400">选一个 Screen 查看详情</div>
        )}
      </div>

      {lightbox ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          <img
            className="max-h-[95vh] max-w-[95vw] rounded object-contain shadow-2xl"
            src={lightbox}
            alt="原型图大图"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute right-5 top-4 rounded bg-white/90 px-3 py-1 text-sm font-medium text-slate-900 hover:bg-white"
            onClick={() => setLightbox(null)}
            type="button"
          >
            关闭 ✕
          </button>
        </div>
      ) : null}
    </div>
  );
}
