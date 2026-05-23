import { useEffect, useMemo, useState } from "react";
import { useDataChange } from "../../lib/useDataChange";
import type {
  ApiEnvelope,
  DesignDoc,
  DesignSummary,
  ModuleWithFeatures
} from "../../types";
import { CreateIssueDialog } from "../CreateIssueDialog";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { GlobalFeedbackPanel } from "../GlobalFeedbackPanel";
import { PromptModalDialog, type PromptMode } from "../PromptModalDialog";

interface DesignTabProps {
  productId: string;
  readOnly?: boolean;
  /** 外部要求打开某个设计页时设置;切回 null 表示无外部请求 */
  openName: string | null;
  onOpenDesign?: (name: string) => void;
}

/**
 * 双轨设计区:每个 feature 对应一个 markdown 文件。
 * - 左侧列文件名
 * - 右侧渲染 markdown,可读写时支持编辑/保存
 * - 顶部「+ 为某 feature 新建」按钮
 */
export function DesignTab({ productId, readOnly = false, openName, onOpenDesign }: DesignTabProps) {
  const [list, setList] = useState<DesignSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [doc, setDoc] = useState<DesignDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState<PromptMode | null>(null);

  const loadList = async () => {
    try {
      const res = await fetch(`/api/products/${productId}/designs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as ApiEnvelope<DesignSummary[]>;
      setList(body.data);
      setErr(null);
      // 若未选中 + 有外部 openName 则优先,否则取第一个
      if (selected === null) {
        if (openName && body.data.some((d) => d.name === openName)) {
          setSelected(openName);
        } else if (body.data.length > 0) {
          setSelected(body.data[0].name);
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载设计列表失败");
    }
  };

  const loadDoc = async (name: string) => {
    try {
      const res = await fetch(`/api/products/${productId}/designs/${name}`);
      if (res.status === 404) {
        setDoc(null);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as ApiEnvelope<DesignDoc>;
      setDoc(body.data);
      setDraft(body.data.body);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载设计文档失败");
    }
  };

  useEffect(() => {
    setSelected(null);
    setDoc(null);
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  useEffect(() => {
    if (openName && openName !== selected) {
      setSelected(openName);
    }
  }, [openName, selected]);

  useEffect(() => {
    if (selected) void loadDoc(selected);
    else setDoc(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useDataChange(() => {
    void loadList();
    if (selected) void loadDoc(selected);
  });

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/products/${productId}/designs/${selected}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as ApiEnvelope<DesignDoc>;
      setDoc(body.data);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    if (!window.confirm(`删除设计页 ${selected}?该操作不可恢复。`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/products/${productId}/designs/${selected}`, {
        method: "DELETE"
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSelected(null);
      setDoc(null);
      await loadList();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-0 flex-col">
      <GlobalFeedbackPanel productId={productId} scope="prototype" />
      <div className="flex items-center justify-end border-b border-slate-200 bg-slate-50 px-5 py-1.5">
        <button
          className="rounded border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 hover:border-slate-900 hover:text-slate-900"
          onClick={() => setPromptOpen("generate")}
          title="基于现有 features 生成原型对应关系的 prompt(占位)"
          type="button"
        >
          生成原型对应
        </button>
      </div>
      <div className="grid min-h-0 grid-cols-[260px_1fr]">
      <aside className="border-r border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <div className="text-xs font-medium text-slate-500">设计页</div>
          {!readOnly ? (
            <button
              className="rounded border border-dashed border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:border-slate-500 hover:text-slate-900"
              onClick={() => setCreating(true)}
              type="button"
            >
              + 新建
            </button>
          ) : null}
        </div>

        {creating ? (
          <NewDesignForm
            onCancel={() => setCreating(false)}
            onCreated={(name) => {
              setCreating(false);
              setSelected(name);
              onOpenDesign?.(name);
              void loadList();
            }}
            productId={productId}
          />
        ) : null}

        {list.length === 0 && !creating ? (
          <div className="px-4 py-4 text-xs text-slate-400">
            该产品暂无设计页;点上面「+ 新建」为某个功能点创建。
          </div>
        ) : (
          <ul>
            {list.map((d) => {
              const active = d.name === selected;
              return (
                <li key={d.name}>
                  <button
                    className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition ${
                      active ? "bg-slate-900 text-white" : "text-slate-800 hover:bg-slate-100"
                    }`}
                    onClick={() => setSelected(d.name)}
                    type="button"
                  >
                    <span className="truncate font-mono text-xs">{d.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <div className="min-h-0 overflow-auto">
        {err ? (
          <div className="m-5 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {err}
          </div>
        ) : null}

        {selected && doc ? (
          <div className="p-5">
            <header className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs text-slate-500 font-mono">{selected}.md</div>
                <h2 className="mt-0.5 truncate text-lg font-semibold text-slate-950">{selected}</h2>
              </div>
              <div className="flex items-center gap-1">
                <button
                  aria-label="向 GitHub 提 issue"
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  onClick={() => setIssueOpen(true)}
                  title="向 GitHub 提 issue"
                  type="button"
                >
                  💬
                </button>
                {!readOnly && !editing ? (
                  <>
                    <button
                      className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:border-slate-500"
                      onClick={() => {
                        setDraft(doc.body);
                        setEditing(true);
                      }}
                      type="button"
                    >
                      编辑
                    </button>
                    <button
                      aria-label="删除设计页"
                      className="rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                      disabled={busy}
                      onClick={remove}
                      title="删除设计页"
                      type="button"
                    >
                      🗑
                    </button>
                  </>
                ) : null}
              </div>
            </header>

            {editing ? (
              <>
                <textarea
                  className="h-[460px] w-full rounded border border-slate-300 bg-white p-3 font-mono text-xs leading-6"
                  onChange={(e) => setDraft(e.target.value)}
                  value={draft}
                />
                <div className="mt-2 flex gap-2">
                  <button
                    className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-60"
                    disabled={busy || draft === doc.body}
                    onClick={save}
                    type="button"
                  >
                    {busy ? "保存中..." : "保存"}
                  </button>
                  <button
                    className="rounded px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
                    onClick={() => {
                      setDraft(doc.body);
                      setEditing(false);
                    }}
                    type="button"
                  >
                    取消
                  </button>
                </div>
              </>
            ) : (
              <div className="rounded-md border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-800">
                <MarkdownRenderer markdown={doc.body} />
              </div>
            )}
          </div>
        ) : selected ? (
          <div className="p-5 text-sm text-slate-500">该设计页不存在或已被删除。</div>
        ) : (
          <div className="p-5 text-sm text-slate-500">选择左侧设计页查看,或点击「+ 新建」创建。</div>
        )}
      </div>

      {doc ? (
        <CreateIssueDialog
          defaultBody={buildDesignIssueBody(doc, productId)}
          defaultLabels="design"
          defaultTitle={`[design] ${doc.name}:`}
          onClose={() => setIssueOpen(false)}
          open={issueOpen}
          productId={productId}
        />
      ) : null}
      </div>
      <button
        className="fixed bottom-4 right-4 z-30 rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white shadow-lg hover:bg-slate-800"
        onClick={() => setPromptOpen("revise")}
        title="原型修订 prompt(本批次为占位)"
        type="button"
      >
        复制全局 revise prompt(原型)
      </button>
      {promptOpen ? (
        <PromptModalDialog
          mode={promptOpen}
          onClose={() => setPromptOpen(null)}
          productId={productId}
          scope="prototype"
        />
      ) : null}
    </div>
  );
}

function buildDesignIssueBody(doc: DesignDoc, productId: string): string {
  const source = `data/designs/${productId}/${doc.name}.md`;
  const preview = doc.body.slice(0, 400);
  return [
    `**设计页**: \`${doc.name}\``,
    `**Atlas 源文件**: \`${source}\``,
    "",
    "## 现状摘要",
    preview || "_(空文档)_",
    "",
    "## 修改诉求",
    "<!-- 请在此填写要修改/新增的内容 -->"
  ].join("\n");
}

function NewDesignForm({
  productId,
  onCancel,
  onCreated
}: {
  productId: string;
  onCancel: () => void;
  onCreated: (name: string) => void;
}) {
  const [features, setFeatures] = useState<Array<{ id: string; name: string }>>([]);
  const [pickedId, setPickedId] = useState("");
  const [customName, setCustomName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/products/${productId}/modules-with-features`);
        if (!res.ok) return;
        const body = (await res.json()) as ApiEnvelope<ModuleWithFeatures[]>;
        const flat: Array<{ id: string; name: string }> = [];
        for (const m of body.data) {
          for (const f of m.features) flat.push({ id: f.id, name: f.name });
        }
        setFeatures(flat);
        if (flat.length > 0) setPickedId(flat[0].id);
      } catch {
        // ignore
      }
    })();
  }, [productId]);

  const finalName = useMemo(() => (customName.trim() || pickedId), [customName, pickedId]);
  const featureName = features.find((f) => f.id === pickedId)?.name;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!finalName) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/products/${productId}/designs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: finalName, featureName })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status}`);
      }
      onCreated(finalName);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-2 border-b border-slate-200 bg-slate-50 px-4 py-3" onSubmit={submit}>
      <div className="text-xs font-semibold text-slate-900">新建设计页</div>
      <label className="block text-xs text-slate-600">
        绑定 feature
        <select
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
          onChange={(e) => setPickedId(e.target.value)}
          value={pickedId}
        >
          {features.length === 0 ? (
            <option value="">(暂无功能点)</option>
          ) : (
            features.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.id})
              </option>
            ))
          )}
        </select>
      </label>
      <label className="block text-xs text-slate-600">
        文件名(默认 = feature id)
        <input
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
          onChange={(e) => setCustomName(e.target.value.trim())}
          placeholder={pickedId}
          value={customName}
        />
      </label>
      {err ? <div className="text-xs text-rose-700">{err}</div> : null}
      <div className="flex gap-2 pt-1">
        <button
          className="rounded bg-slate-900 px-2.5 py-1 text-xs text-white disabled:opacity-60"
          disabled={busy || !finalName}
          type="submit"
        >
          {busy ? "创建中..." : "创建"}
        </button>
        <button
          className="rounded px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900"
          onClick={onCancel}
          type="button"
        >
          取消
        </button>
      </div>
    </form>
  );
}
