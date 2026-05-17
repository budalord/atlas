import { useEffect, useState } from "react";
import type { ApiEnvelope, EntitySpec, ModuleSpec } from "../../types";
import { useDataChange } from "../../lib/useDataChange";
import { CreateIssueDialog } from "../CreateIssueDialog";
import { FeedbackPool } from "../FeedbackPool";
import { GlobalFeedbackPanel } from "../GlobalFeedbackPanel";
import { PromptModalDialog, type PromptMode } from "../PromptModalDialog";

interface EntityTabProps {
  productId: string;
  readOnly?: boolean;
}

type ViewMode = "by-module" | "all";

export function EntityTab({ productId, readOnly = false }: EntityTabProps) {
  const [entities, setEntities] = useState<EntitySpec[] | null>(null);
  const [modules, setModules] = useState<ModuleSpec[]>([]);
  const [view, setView] = useState<ViewMode>("by-module");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [promptOpen, setPromptOpen] = useState<PromptMode | null>(null);

  const load = async () => {
    try {
      const [entRes, modRes] = await Promise.all([
        fetch(`/api/products/${productId}/entities`),
        fetch(`/api/products/${productId}/modules`)
      ]);
      if (!entRes.ok) throw new Error(`entities ${entRes.status}`);
      if (!modRes.ok) throw new Error(`modules ${modRes.status}`);
      const entJson = (await entRes.json()) as ApiEnvelope<EntitySpec[]>;
      const modJson = (await modRes.json()) as ApiEnvelope<ModuleSpec[]>;
      setEntities(entJson.data);
      setModules(modJson.data);
      setError(null);
      if (selected === null && entJson.data.length > 0) {
        setSelected(entJson.data[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  };

  useEffect(() => {
    setSelected(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  useDataChange(() => {
    void load();
  });

  if (error) return <div className="p-5 text-sm text-rose-700">{error}</div>;
  if (entities === null) return <div className="p-5 text-xs text-slate-500">加载中...</div>;

  const current = entities.find((e) => e.id === selected) ?? null;

  // 按模块分组
  const groupKeys: { key: string | null; label: string }[] = [
    { key: null, label: "共享实体" },
    ...modules.map((m) => ({ key: m.name, label: m.title }))
  ];

  return (
    <div className="relative flex min-h-0 flex-col">
      <GlobalFeedbackPanel productId={productId} scope="entity" />
      {/* 顶部工具栏:始终显示 revise(实体级),空态时再额外显示 generate */}
      {!readOnly ? (
        <div className="flex items-center justify-end gap-2 border-b border-slate-200 bg-slate-50 px-5 py-1.5">
          {entities.length === 0 ? (
            <button
              className="rounded border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 hover:border-slate-900 hover:text-slate-900"
              onClick={() => setPromptOpen("generate")}
              title="基于现有 features 生成 entities 骨架的 prompt(给实体 Agent)"
              type="button"
            >
              📋 实体 Agent · 生成实体骨架
            </button>
          ) : null}
          <button
            className="rounded bg-slate-900 px-3 py-1 text-[11px] font-medium text-white hover:bg-slate-800"
            onClick={() => setPromptOpen("revise")}
            title="把 needs_revision=true 的 entity 反馈 + 全局需求 拼成 prompt"
            type="button"
          >
            📋 复制全局 revise prompt(实体)
          </button>
        </div>
      ) : null}
      <div className="grid min-h-0 grid-cols-[260px_1fr]">
      <aside className="border-r border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <div className="text-xs font-medium text-slate-500">实体</div>
          <div className="flex items-center gap-1">
            <button
              className={`rounded px-2 py-0.5 text-[11px] ${
                view === "by-module" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
              onClick={() => setView("by-module")}
              type="button"
            >
              按模块
            </button>
            <button
              className={`rounded px-2 py-0.5 text-[11px] ${
                view === "all" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
              onClick={() => setView("all")}
              type="button"
            >
              全部
            </button>
          </div>
        </div>

        {!readOnly ? (
          <div className="border-b border-slate-200 px-4 py-2">
            <button
              className="w-full rounded border border-dashed border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:border-slate-500 hover:text-slate-900"
              onClick={() => setCreating(true)}
              type="button"
            >
              + 新建实体
            </button>
          </div>
        ) : null}

        {view === "all" ? (
          <EntityList entities={entities} onSelect={setSelected} selected={selected} />
        ) : (
          <div>
            {groupKeys.map((g) => {
              const list = entities.filter((e) => e.module === g.key);
              if (list.length === 0 && g.key !== null) return null;
              return (
                <div key={g.label}>
                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-1 text-[11px] font-medium text-slate-500">
                    {g.label} {list.length > 0 ? `(${list.length})` : ""}
                  </div>
                  <EntityList entities={list} onSelect={setSelected} selected={selected} />
                </div>
              );
            })}
          </div>
        )}
      </aside>

      <div className="min-h-0 overflow-auto">
        {creating ? (
          <NewEntityForm
            modules={modules}
            onCancel={() => setCreating(false)}
            onCreated={(name) => {
              setCreating(false);
              setSelected(name);
              void load();
            }}
            productId={productId}
          />
        ) : null}
        {current ? (
          <EntityDetail
            entity={current}
            onChanged={() => void load()}
            productId={productId}
            readOnly={readOnly}
            onDelete={async () => {
              if (!window.confirm(`删除实体 ${current.id}? 该操作不可恢复。`)) return;
              try {
                const res = await fetch(`/api/products/${productId}/entities/${current.id}`, {
                  method: "DELETE"
                });
                if (!res.ok) {
                  const body = await res.json().catch(() => ({}));
                  throw new Error(body.error ?? `HTTP ${res.status}`);
                }
                setSelected(null);
                await load();
              } catch (e) {
                window.alert(e instanceof Error ? e.message : "删除失败");
              }
            }}
          />
        ) : (
          <div className="p-5 text-sm text-slate-500">选择左侧实体查看详情。</div>
        )}
      </div>
      </div>
      {promptOpen ? (
        <PromptModalDialog
          mode={promptOpen}
          onClose={() => setPromptOpen(null)}
          productId={productId}
          scope="entity"
        />
      ) : null}
    </div>
  );
}

function EntityList({
  entities,
  onSelect,
  selected
}: {
  entities: EntitySpec[];
  onSelect: (id: string) => void;
  selected: string | null;
}) {
  if (entities.length === 0) {
    return <div className="px-4 py-3 text-xs text-slate-400">—</div>;
  }
  return (
    <ul>
      {entities.map((e) => {
        const active = e.id === selected;
        return (
          <li key={`${e.module ?? "_shared"}/${e.id}`}>
            <button
              className={`flex w-full items-center px-4 py-2 text-left text-sm transition ${
                active ? "bg-slate-900 text-white" : "text-slate-800 hover:bg-slate-100"
              }`}
              onClick={() => onSelect(e.id)}
              type="button"
            >
              <span className="truncate">{e.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function EntityDetail({
  entity,
  productId,
  readOnly,
  onDelete,
  onChanged
}: {
  entity: EntitySpec;
  productId: string;
  readOnly: boolean;
  onDelete: () => void;
  onChanged: () => void;
}) {
  // target 字符串:顶层 entity → "entity:<id>";模块下 entity → "entity:<m>:<id>"
  const feedbackTarget = entity.module
    ? `entity:${entity.module}:${entity.id}`
    : `entity:${entity.id}`;
  const addedPhase = entity.added_in_phase;
  const showBanner = addedPhase && addedPhase !== "planning";
  const [issueOpen, setIssueOpen] = useState(false);
  return (
    <div className="space-y-5 p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">
            {entity.module ? `模块 ${entity.module}` : "共享实体"}
          </div>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">{entity.name}</h2>
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
          {!readOnly ? (
            <button
              aria-label="删除实体"
              className="rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
              onClick={onDelete}
              title="删除实体"
              type="button"
            >
              🗑
            </button>
          ) : null}
        </div>
      </header>
      <CreateIssueDialog
        defaultBody={buildEntityIssueBody(entity, productId)}
        defaultLabels="entity"
        defaultTitle={`[entity] ${entity.id}:`}
        onClose={() => setIssueOpen(false)}
        open={issueOpen}
        productId={productId}
      />

      {showBanner ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          该实体在【{addedPhase === "in-progress" ? "进行中" : "已上线"}】阶段
          {entity.added_at ? `(${entity.added_at})` : ""}追加;此前已开发的代码不受影响。
        </div>
      ) : null}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">字段</h3>
        {entity.fields.length === 0 ? (
          <div className="text-xs text-slate-500">—</div>
        ) : (
          <div className="overflow-hidden rounded-md border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">字段</th>
                  <th className="px-3 py-2 text-left font-medium">类型</th>
                  <th className="px-3 py-2 text-left font-medium">必填</th>
                  <th className="px-3 py-2 text-left font-medium">约束</th>
                  <th className="px-3 py-2 text-left font-medium">备注</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entity.fields.map((f, idx) => (
                  <tr key={idx}>
                    <td className="px-3 py-2 font-mono text-xs text-slate-900">{f.name}</td>
                    <td className="px-3 py-2 text-slate-700">{f.type}</td>
                    <td className="px-3 py-2 text-slate-700">{f.required}</td>
                    <td className="px-3 py-2 text-slate-700">{f.constraint}</td>
                    <td className="px-3 py-2 text-slate-700">{f.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">关系</h3>
        {entity.relations.length === 0 ? (
          <div className="text-xs text-slate-500">—</div>
        ) : (
          <ul className="space-y-1.5">
            {entity.relations.map((r, idx) => (
              <li className="flex items-center gap-2 text-sm" key={idx}>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                  {r.cardinality}
                </span>
                <span className="text-slate-900">→ {r.target}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">决策</h3>
        {entity.decisions.length === 0 ? (
          <div className="text-xs text-slate-500">—</div>
        ) : (
          <ul className="space-y-2">
            {entity.decisions.map((d, idx) => (
              <li className="rounded-md border border-slate-200 bg-white px-3 py-2" key={idx}>
                <div className="text-sm font-semibold text-slate-900">{d.title}</div>
                {d.rationale ? (
                  <div className="mt-1 text-sm leading-6 text-slate-700">{d.rationale}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 批次 2 · 反馈池 — 决策段之下,装 Agent 提案 / 自留备注 / 阶段验收 */}
      <FeedbackPool
        feedback={entity.feedback ?? []}
        onChanged={onChanged}
        productId={productId}
        readOnly={readOnly}
        target={feedbackTarget}
      />
    </div>
  );
}

function NewEntityForm({
  modules,
  productId,
  onCancel,
  onCreated
}: {
  modules: ModuleSpec[];
  productId: string;
  onCancel: () => void;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [moduleName, setModuleName] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[a-z][a-z0-9_-]*$/i.test(name)) {
      setErr("名称只能含字母/数字/-/_,且以字母开头");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/products/${productId}/entities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, module: moduleName || null })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status}`);
      }
      onCreated(name);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="m-5 rounded-md border border-slate-300 bg-white p-4" onSubmit={onSubmit}>
      <div className="mb-3 text-sm font-semibold text-slate-900">新建实体</div>
      <div className="space-y-3">
        <label className="block">
          <div className="mb-1 text-xs text-slate-600">实体名(英文标识)</div>
          <input
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            onChange={(e) => setName(e.target.value)}
            placeholder="student"
            value={name}
          />
        </label>
        <label className="block">
          <div className="mb-1 text-xs text-slate-600">所属模块</div>
          <select
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            onChange={(e) => setModuleName(e.target.value)}
            value={moduleName}
          >
            <option value="">— 共享(顶层 entities/)</option>
            {modules.map((m) => (
              <option key={m.name} value={m.name}>
                {m.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {err ? <div className="mt-2 text-xs text-rose-700">{err}</div> : null}
      <div className="mt-3 flex gap-2">
        <button
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-60"
          disabled={submitting || !name}
          type="submit"
        >
          {submitting ? "创建中..." : "创建"}
        </button>
        <button
          className="rounded px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
          onClick={onCancel}
          type="button"
        >
          取消
        </button>
      </div>
    </form>
  );
}

function buildEntityIssueBody(entity: EntitySpec, productId: string): string {
  const source = entity.module
    ? `data/products/${productId}/modules/${entity.module}/entities/${entity.id}.md`
    : `data/products/${productId}/entities/${entity.id}.md`;
  const fields = entity.fields.slice(0, 6).map((f) => `- \`${f.name}\` (${f.type})${f.is_tbd ? " [TBD]" : ""}`).join("\n");
  return [
    `**实体**: ${entity.name} (\`${entity.id}\`)`,
    `**模块**: ${entity.module ?? "(共享)"}`,
    `**Atlas 源文件**: \`${source}\``,
    "",
    "## 当前字段摘要",
    fields || "_(无字段)_",
    "",
    "## 修改诉求",
    "<!-- 请在此填写要修改/新增的内容 -->"
  ].join("\n");
}
