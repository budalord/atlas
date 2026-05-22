import { useCallback, useEffect, useState } from "react";
import type {
  ApiEnvelope,
  DerivedEntitiesData,
  DerivedEntity,
  DerivedEntityQuestionsData,
  EntityReconcileReport,
  EntitySpec,
  ModuleSpec
} from "../../types";
import { useDataChange } from "../../lib/useDataChange";
import { CreateIssueDialog } from "../CreateIssueDialog";
import { FeedbackPool } from "../FeedbackPool";
import { GlobalFeedbackPanel } from "../GlobalFeedbackPanel";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { PromptModalDialog, type PromptMode } from "../PromptModalDialog";

interface EntityTabProps {
  productId: string;
  readOnly?: boolean;
}

type ViewMode = "by-module" | "all";
type SubTab = "declared" | "derived";

export function EntityTab({ productId, readOnly = false }: EntityTabProps) {
  const [subTab, setSubTab] = useState<SubTab>("declared");

  return (
    <div className="relative flex min-h-0 flex-col">
      <nav className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-5">
        <SubTabButton
          active={subTab === "declared"}
          label="声明"
          onClick={() => setSubTab("declared")}
        />
        <SubTabButton
          active={subTab === "derived"}
          label="派生"
          onClick={() => setSubTab("derived")}
        />
        <span className="ml-3 text-[11px] text-slate-500">
          {subTab === "declared"
            ? "声明实体:用户/Agent 直接写的 source(modules/<m>/entities/* + entities/*)"
            : "派生实体:Path C — 由 features + SEAMS + DECISIONS + ENTITIES-OWNERSHIP 派生(只读)"}
        </span>
      </nav>
      {subTab === "declared" ? (
        <DeclaredEntitiesPanel productId={productId} readOnly={readOnly} />
      ) : (
        <DerivedEntitiesPanel productId={productId} readOnly={readOnly} />
      )}
    </div>
  );
}

function SubTabButton({
  active,
  label,
  onClick
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
        active
          ? "border-slate-900 font-semibold text-slate-950"
          : "border-transparent text-slate-500 hover:text-slate-800"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function DeclaredEntitiesPanel({ productId, readOnly = false }: EntityTabProps) {
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

/* ============================================================
 *  派生实体面板 (Path C)
 * ============================================================ */
function DerivedEntitiesPanel({ productId, readOnly = false }: EntityTabProps) {
  const [data, setData] = useState<DerivedEntitiesData | null>(null);
  const [questions, setQuestions] = useState<DerivedEntityQuestionsData | null>(null);
  const [reconcile, setReconcile] = useState<EntityReconcileReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r1, r2, r3] = await Promise.all([
        fetch(`/api/products/${productId}/derived-entities`),
        fetch(`/api/products/${productId}/derived-entities/questions`),
        fetch(`/api/products/${productId}/derived-entities/reconcile`)
      ]);
      if (!r1.ok) throw new Error(`derived-entities ${r1.status}`);
      if (!r2.ok) throw new Error(`derived-entities/questions ${r2.status}`);
      if (!r3.ok) throw new Error(`derived-entities/reconcile ${r3.status}`);
      const e = (await r1.json()) as ApiEnvelope<DerivedEntitiesData>;
      const q = (await r2.json()) as ApiEnvelope<DerivedEntityQuestionsData>;
      const c = (await r3.json()) as ApiEnvelope<EntityReconcileReport>;
      setData(e.data);
      setQuestions(q.data);
      setReconcile(c.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  useDataChange(() => {
    void load();
  });

  if (error) return <div className="p-5 text-sm text-rose-700">{error}</div>;
  if (data === null) return <div className="p-5 text-xs text-slate-500">加载中...</div>;

  const hasQuestionsLint = questions && !questions.questions_lint_ok && questions.questions_lint_errors.length > 0;

  return (
    <div className="flex min-h-0 flex-col overflow-auto">
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-5 py-2">
        <div className="text-[12px] text-slate-600">
          {data.exists ? (
            <>
              <span className="font-medium text-slate-900">{data.entities.length}</span> 个派生实体
              {data.generated_at ? (
                <span className="ml-2 text-slate-500">· 生成于 {formatTime(data.generated_at)}</span>
              ) : null}
            </>
          ) : (
            <span className="text-slate-500">尚无派生实体</span>
          )}
        </div>
        {!readOnly ? (
          <button
            className="rounded border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 hover:border-slate-900 hover:text-slate-900"
            onClick={() => setPromptOpen(true)}
            title="生成 Path C 派生 prompt(复制后给外部 Agent 跑)"
            type="button"
          >
            📋 派生 Agent · {data.exists ? "重派生" : "生成派生实体"}
          </button>
        ) : null}
      </div>

      {/* stale 横幅 */}
      {data.stale ? (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-[12px] text-amber-900">
          ⚠ 派生已过期:{data.stale_reason}
        </div>
      ) : null}

      {/* questions.md 横幅 */}
      {questions && questions.exists && questions.questions.length > 0 ? (
        <div className={`border-b px-5 py-2 text-[12px] ${
          hasQuestionsLint
            ? "border-rose-200 bg-rose-50 text-rose-800"
            : "border-orange-200 bg-orange-50 text-orange-800"
        }`}>
          <div className="font-medium">
            📋 派生 Agent 抛了 {questions.questions.length} 个 question(待源端澄清){hasQuestionsLint ? " · ⚠ 含 trigger lint 错误" : ""}
          </div>
          {hasQuestionsLint ? (
            <ul className="mt-1 list-disc pl-5 text-[11px]">
              {questions.questions_lint_errors.slice(0, 3).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
              {questions.questions_lint_errors.length > 3 ? (
                <li>... ({questions.questions_lint_errors.length - 3} more)</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* 空态 */}
      {!data.exists ? (
        <div className="m-5 rounded-md border border-dashed border-slate-300 bg-white p-6 text-center text-[13px] leading-6 text-slate-600">
          <div className="text-[14px] font-medium text-slate-900">尚未生成派生实体</div>
          <div className="mt-1 text-slate-500">
            Path C 派生从 features + SEAMS + DECISIONS + ENTITIES-OWNERSHIP 派生实体清单。
          </div>
          {!readOnly ? (
            <button
              className="mt-3 rounded bg-slate-900 px-4 py-1.5 text-[12px] text-white hover:bg-slate-800"
              onClick={() => setPromptOpen(true)}
              type="button"
            >
              📋 复制派生 prompt
            </button>
          ) : null}
        </div>
      ) : null}

      {/* questions 列表(简略) */}
      {questions && questions.questions.length > 0 ? (
        <details className="border-b border-slate-200 bg-white px-5 py-2">
          <summary className="cursor-pointer text-[12px] font-medium text-slate-800">
            ▸ 完整 questions 列表 ({questions.questions.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {questions.questions.map((q, i) => (
              <li className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[12px]" key={i}>
                <div className="font-medium text-slate-900">{q.question}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                  <span>feature: {q.feature}</span>
                  <span>module: {q.module}</span>
                  <span>trigger: <code className="font-mono">{q.trigger.feature_path}</code></span>
                </div>
                {q.proposed_resolution ? (
                  <div className="mt-1 text-[11px] text-emerald-700">
                    建议处理:{q.proposed_resolution}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* reconcile 报告 */}
      {reconcile && reconcile.exists ? (
        <details className="border-b border-slate-200 bg-white px-5 py-2" open>
          <summary className="cursor-pointer text-[12px] font-medium text-slate-800">
            ▾ Reconcile 报告:派生 vs ENTITIES-OWNERSHIP 声明
            <span className="ml-2 text-[11px] font-normal text-slate-500">
              派生有声明无 {reconcile.derivedOnly.length} · 声明有派生无 {reconcile.declaredOnly.length} · 归属不一致 {reconcile.layerMismatch.length}
            </span>
          </summary>
          <div className="mt-2 grid grid-cols-1 gap-3 text-[12px] lg:grid-cols-3">
            <ReconcileSection diffs={reconcile.derivedOnly} title="派生有声明无" tone="amber" />
            <ReconcileSection diffs={reconcile.declaredOnly} title="声明有派生无" tone="slate" />
            <ReconcileSection diffs={reconcile.layerMismatch} title="归属不一致" tone="rose" />
          </div>
        </details>
      ) : null}

      {/* 派生实体卡片列表 */}
      {data.entities.length > 0 ? (
        <ul className="m-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {data.entities.map((entity) => (
            <li key={entity.name}>
              <DerivedEntityCard entity={entity} />
            </li>
          ))}
        </ul>
      ) : null}

      {promptOpen ? (
        <PromptModalDialog
          mode="generate"
          onClose={() => setPromptOpen(false)}
          productId={productId}
          scope="entity-derive"
        />
      ) : null}
    </div>
  );
}

function ReconcileSection({
  title,
  diffs,
  tone
}: {
  title: string;
  diffs: EntityReconcileReport["derivedOnly"];
  tone: "amber" | "slate" | "rose";
}) {
  const toneCls = {
    amber: "border-amber-200 bg-amber-50/40",
    slate: "border-slate-200 bg-slate-50",
    rose: "border-rose-200 bg-rose-50/40"
  }[tone];
  return (
    <div className={`rounded-md border px-3 py-2 ${toneCls}`}>
      <div className="text-[12px] font-medium text-slate-900">
        {title}{" "}
        <span className="text-[10px] font-normal text-slate-500">({diffs.length})</span>
      </div>
      {diffs.length === 0 ? (
        <div className="mt-1 text-[11px] italic text-slate-400">—</div>
      ) : (
        <ul className="mt-1 space-y-1">
          {diffs.map((d, i) => (
            <li className="text-[11px] leading-5" key={i}>
              <span className="font-mono font-semibold text-slate-800">{d.name}</span>
              {d.declaredLayer ? <span className="ml-1 text-slate-500">·声明:{d.declaredLayer}</span> : null}
              {d.derivedLayer ? <span className="ml-1 text-slate-500">·派生:{d.derivedLayer}</span> : null}
              {d.derivedNote ? <span className="ml-1 text-slate-600">·{d.derivedNote}</span> : null}
              {d.suggestion ? <div className="text-slate-600">{d.suggestion}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DerivedEntityCard({ entity }: { entity: DerivedEntity }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <button
        className="flex w-full items-baseline gap-3 px-4 py-2 text-left hover:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="text-slate-500">{open ? "▾" : "▸"}</span>
        <span className="font-mono text-[13px] font-semibold text-slate-900">{entity.name}</span>
        <span className="text-[11px] text-slate-500">{entity.layer}</span>
        <span className="ml-auto text-[10px] text-slate-400">
          features × {entity.sourceFeatures.length}
          {entity.sourceSeams.length > 0 ? ` · seams × ${entity.sourceSeams.length}` : ""}
          {entity.sourceDecisions.length > 0 ? ` · decisions × ${entity.sourceDecisions.length}` : ""}
        </span>
      </button>
      {open ? (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span className="text-slate-500">维护:</span>
              <span className="ml-1 text-slate-800">{entity.maintainers}</span>
            </div>
            <div>
              <span className="text-slate-500">生成于:</span>
              <span className="ml-1 text-slate-800">{entity.generated_at ? formatTime(entity.generated_at) : "—"}</span>
            </div>
          </div>
          {entity.sourceFeatures.length > 0 ? (
            <div className="mt-2 text-[11px]">
              <span className="text-slate-500">来源 features:</span>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {entity.sourceFeatures.map((f) => (
                  <code key={f} className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                    {f}
                  </code>
                ))}
              </div>
            </div>
          ) : null}
          {entity.sourceSeams.length > 0 ? (
            <div className="mt-2 text-[11px]">
              <span className="text-slate-500">来源 seams:</span>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {entity.sourceSeams.map((s) => (
                  <code key={s} className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                    {s}
                  </code>
                ))}
              </div>
            </div>
          ) : null}
          {entity.sourceDecisions.length > 0 ? (
            <div className="mt-2 text-[11px]">
              <span className="text-slate-500">来源 decisions:</span>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {entity.sourceDecisions.map((d) => (
                  <code key={d} className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                    {d}
                  </code>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-3 prose prose-sm max-w-none">
            <MarkdownRenderer markdown={entity.body} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 16).replace("T", " ");
  } catch {
    return iso;
  }
}
