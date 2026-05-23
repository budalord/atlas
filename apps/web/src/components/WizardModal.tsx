import { useMemo, useState } from "react";
import type {
  ActorType,
  CapabilityPriority
} from "../types";

interface WizardModalProps {
  onClose: () => void;
  onCreated: (productId: string) => void;
}

type StepKey = 1 | 2 | 3 | 4 | 5 | 6;

interface ProjectInput {
  id: string;
  name: string;
  theme: string;
  tagline: string;
  description: string;
  in_scope: string[];
  out_of_scope: string[];
}

interface ActorInput {
  id: string;
  name: string;
  type: ActorType;
  responsibilities: string;
}

interface EntityInput {
  name: string; // PascalCase
}

interface CapabilityInput {
  id: string;
  name: string;
  domain: string;
  value_statement: string;
  actor_ids: string[];
  entity_ids: string[];
  priority: CapabilityPriority;
}

interface FunctionInput {
  id: string;
  name: string;
  module: string;
  capability_id: string;
  actor_ids: string[];
  entities_touched: string[];
}

const ACTOR_TYPES: { value: ActorType; label: string }[] = [
  { value: "internal_user", label: "内部用户" },
  { value: "external_user", label: "外部用户" },
  { value: "external_system", label: "外部系统" }
];

const PRIORITIES: { value: CapabilityPriority; label: string }[] = [
  { value: "P0", label: "P0" },
  { value: "P1", label: "P1" },
  { value: "P2", label: "P2" }
];

const DOMAIN_POOL = ["招生", "教务", "财务", "人事", "数据集成", "决策与报表"];

const STEP_LABELS: Record<StepKey, string> = {
  1: "1. 项目基础信息",
  2: "2. Actor 识别",
  3: "3. Entity 识别",
  4: "4. Capability 生成",
  5: "5. Function 拆解(可跳)",
  6: "6. 总览与一致性"
};

/**
 * 立项 Wizard 6 步 (v0.1 rev3)
 *
 * 单向推进 + 可回退。每步独立 state, 最后一步聚合 POST /api/products/wizard/init。
 * 各步骤的 Agent 反问通过既有 PromptModalDialog scope=... 触发, 用户复制 prompt 喂 agent 后手动落库(本 Wizard 不内嵌 agent)。
 */
export function WizardModal({ onClose, onCreated }: WizardModalProps) {
  const [step, setStep] = useState<StepKey>(1);
  const [project, setProject] = useState<ProjectInput>({
    id: "",
    name: "",
    theme: "custom",
    tagline: "",
    description: "",
    in_scope: [],
    out_of_scope: []
  });
  const [actors, setActors] = useState<ActorInput[]>([]);
  const [entities, setEntities] = useState<EntityInput[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityInput[]>([]);
  const [functions, setFunctions] = useState<FunctionInput[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 推导 modules (从 function.module unique)
  const modules = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const f of functions) {
      const m = f.module.trim();
      if (m && !seen.has(m)) seen.set(m, { id: m, name: m });
    }
    return Array.from(seen.values());
  }, [functions]);

  const canNext = useMemo(() => stepValid(step, { project, actors, entities, capabilities, functions, modules }), [step, project, actors, entities, capabilities, functions, modules]);

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        product: project,
        actors,
        capabilities,
        functions,
        modules
      };
      const res = await fetch(`/api/products/wizard/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      onCreated(json.data.product_id);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "落盘失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-[85vh] w-[90vw] max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
          <h2 className="text-base font-semibold text-slate-900">🎉 新产品立项 Wizard · v0.1 rev3 五层骨架</h2>
          <button
            className="rounded p-1 text-slate-400 hover:bg-slate-100"
            onClick={onClose}
            type="button"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </header>

        {/* 进度条 + step nav */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6">
          {([1, 2, 3, 4, 5, 6] as StepKey[]).map((s) => (
            <button
              key={s}
              className={`flex-1 border-b-2 px-3 py-2.5 text-[12px] transition ${
                step === s
                  ? "border-slate-900 font-semibold text-slate-950"
                  : s < step
                    ? "border-emerald-400 text-emerald-700 hover:bg-emerald-50/40"
                    : "border-transparent text-slate-400"
              }`}
              onClick={() => setStep(s)}
              type="button"
            >
              {STEP_LABELS[s]}
              {s < step ? " ✓" : ""}
            </button>
          ))}
        </div>

        {/* 步骤内容 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === 1 ? <Step1 project={project} setProject={setProject} /> : null}
          {step === 2 ? <Step2 actors={actors} setActors={setActors} /> : null}
          {step === 3 ? <Step3 entities={entities} setEntities={setEntities} /> : null}
          {step === 4 ? <Step4 capabilities={capabilities} setCapabilities={setCapabilities} actors={actors} entities={entities} /> : null}
          {step === 5 ? <Step5 functions={functions} setFunctions={setFunctions} capabilities={capabilities} actors={actors} entities={entities} /> : null}
          {step === 6 ? <Step6 project={project} actors={actors} entities={entities} capabilities={capabilities} functions={functions} modules={modules} /> : null}
        </div>

        {/* 底部 footer */}
        <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3">
          <button
            className="rounded px-3 py-1.5 text-[12px] text-slate-600 hover:text-slate-900 disabled:opacity-50"
            disabled={step === 1}
            onClick={() => setStep((s) => Math.max(1, (s - 1)) as StepKey)}
            type="button"
          >
            ← 上一步
          </button>
          {submitError ? (
            <span className="text-[11px] text-rose-700" title={submitError}>
              {submitError}
            </span>
          ) : null}
          {step < 6 ? (
            <button
              className="rounded bg-slate-900 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              disabled={!canNext}
              onClick={() => setStep((s) => Math.min(6, (s + 1)) as StepKey)}
              type="button"
            >
              下一步 →
            </button>
          ) : (
            <button
              className="rounded bg-emerald-700 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              disabled={submitting || !canNext}
              onClick={() => void submit()}
              type="button"
            >
              {submitting ? "落盘中..." : "🚀 落盘并创建"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/* ============================================================
 *  Step 1 — 项目基础信息
 * ============================================================ */
function Step1({ project, setProject }: { project: ProjectInput; setProject: (p: ProjectInput) => void }) {
  return (
    <div className="space-y-4">
      <Hint>填项目基础信息。id 是产品唯一标识(kebab-case), name 是中文显示名。范围(scope)能帮助决策者判断"什么不属于本产品"。</Hint>
      <div className="grid grid-cols-2 gap-4">
        <Field label="id (kebab-case)" required>
          <input
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
            onChange={(e) => setProject({ ...project, id: e.target.value })}
            placeholder="my-product"
            value={project.id}
          />
        </Field>
        <Field label="名称 (中文)" required>
          <input
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            onChange={(e) => setProject({ ...project, name: e.target.value })}
            placeholder="我的产品"
            value={project.name}
          />
        </Field>
      </div>
      <Field label="主题 (theme)">
        <input
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          onChange={(e) => setProject({ ...project, theme: e.target.value })}
          placeholder="erp / saas / portal / ..."
          value={project.theme}
        />
      </Field>
      <Field label="标语 (tagline · 一句话)">
        <input
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          onChange={(e) => setProject({ ...project, tagline: e.target.value })}
          placeholder="比如:服务于<目标用户>的<核心价值>"
          value={project.tagline}
        />
      </Field>
      <Field label="描述 (1-2 段)">
        <textarea
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          onChange={(e) => setProject({ ...project, description: e.target.value })}
          placeholder="产品做什么 / 解决谁的什么问题"
          rows={3}
          value={project.description}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <StringListField
          label="范围 (in scope)"
          placeholder="例: 学员管理 / 订单流"
          items={project.in_scope}
          onChange={(arr) => setProject({ ...project, in_scope: arr })}
        />
        <StringListField
          label="不在范围 (out of scope)"
          placeholder="例: 不做支付集成"
          items={project.out_of_scope}
          onChange={(arr) => setProject({ ...project, out_of_scope: arr })}
        />
      </div>
    </div>
  );
}

/* ============================================================
 *  Step 2 — Actor 识别
 * ============================================================ */
function Step2({ actors, setActors }: { actors: ActorInput[]; setActors: (a: ActorInput[]) => void }) {
  const add = () => setActors([...actors, { id: "", name: "", type: "internal_user", responsibilities: "" }]);
  return (
    <div className="space-y-4">
      <Hint>列出参与产品的所有角色。 type 分三类: 内部用户(员工)/ 外部用户(客户家长)/ 外部系统(集成方平台)。</Hint>
      {actors.map((a, idx) => (
        <div key={idx} className="rounded border border-slate-200 bg-white p-3">
          <div className="grid grid-cols-12 gap-2">
            <Field label="id" required compact span={3}>
              <input
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm font-mono"
                onChange={(e) => setActors(actors.map((x, i) => (i === idx ? { ...x, id: e.target.value } : x)))}
                placeholder="sales"
                value={a.id}
              />
            </Field>
            <Field label="名称" required compact span={3}>
              <input
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                onChange={(e) => setActors(actors.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))}
                placeholder="销售"
                value={a.name}
              />
            </Field>
            <Field label="type" required compact span={3}>
              <select
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                onChange={(e) =>
                  setActors(actors.map((x, i) => (i === idx ? { ...x, type: e.target.value as ActorType } : x)))
                }
                value={a.type}
              >
                {ACTOR_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="col-span-3 flex items-end">
              <button
                className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:border-rose-400 hover:text-rose-700"
                onClick={() => setActors(actors.filter((_, i) => i !== idx))}
                type="button"
              >
                删除
              </button>
            </div>
            <div className="col-span-12">
              <Field label="职责摘要" compact>
                <input
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  onChange={(e) =>
                    setActors(actors.map((x, i) => (i === idx ? { ...x, responsibilities: e.target.value } : x)))
                  }
                  placeholder="学员录入 / 订单录入 / 跟进推荐"
                  value={a.responsibilities}
                />
              </Field>
            </div>
          </div>
        </div>
      ))}
      <button
        className="rounded border border-dashed border-slate-300 px-3 py-2 text-[12px] text-slate-600 hover:border-slate-500 hover:text-slate-900"
        onClick={add}
        type="button"
      >
        + 添加 Actor
      </button>
    </div>
  );
}

/* ============================================================
 *  Step 3 — Entity 识别(轻量化, 只收集 name)
 * ============================================================ */
function Step3({ entities, setEntities }: { entities: EntityInput[]; setEntities: (e: EntityInput[]) => void }) {
  const add = () => setEntities([...entities, { name: "" }]);
  return (
    <div className="space-y-4">
      <Hint>
        列出产品涉及的核心业务实体。 v0.1 Wizard 只收集 entity name(PascalCase), 字段/状态/关系由后续派生 prompt 生成 — 不在 Wizard 中收集。
      </Hint>
      {entities.map((e, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <input
            className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
            onChange={(ev) => setEntities(entities.map((x, i) => (i === idx ? { name: ev.target.value } : x)))}
            placeholder="Student / Order / Product (PascalCase)"
            value={e.name}
          />
          <button
            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:border-rose-400 hover:text-rose-700"
            onClick={() => setEntities(entities.filter((_, i) => i !== idx))}
            type="button"
          >
            删除
          </button>
        </div>
      ))}
      <button
        className="rounded border border-dashed border-slate-300 px-3 py-2 text-[12px] text-slate-600 hover:border-slate-500 hover:text-slate-900"
        onClick={add}
        type="button"
      >
        + 添加 Entity
      </button>
    </div>
  );
}

/* ============================================================
 *  Step 4 — Capability
 * ============================================================ */
function Step4({
  capabilities,
  setCapabilities,
  actors,
  entities
}: {
  capabilities: CapabilityInput[];
  setCapabilities: (c: CapabilityInput[]) => void;
  actors: ActorInput[];
  entities: EntityInput[];
}) {
  const add = () =>
    setCapabilities([
      ...capabilities,
      { id: "", name: "", domain: DOMAIN_POOL[0], value_statement: "", actor_ids: [], entity_ids: [], priority: "P1" }
    ]);
  return (
    <div className="space-y-4">
      <Hint>
        Capability 是业务能力, 跨 module 合法。 domain 强制从预定义池 6 选 1。 命名用动宾短语(学员录入/订单创建)。 actor 必须从 Step 2 的列表选, entity 必须从 Step 3。
      </Hint>
      {capabilities.map((c, idx) => (
        <div key={idx} className="rounded border border-slate-200 bg-white p-3">
          <div className="grid grid-cols-12 gap-2">
            <Field label="id (kebab-case)" required compact span={4}>
              <input
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm font-mono"
                onChange={(e) =>
                  setCapabilities(capabilities.map((x, i) => (i === idx ? { ...x, id: e.target.value } : x)))
                }
                placeholder="student-intake"
                value={c.id}
              />
            </Field>
            <Field label="name (动宾)" required compact span={4}>
              <input
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                onChange={(e) =>
                  setCapabilities(capabilities.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                }
                placeholder="学员录入"
                value={c.name}
              />
            </Field>
            <Field label="domain" required compact span={2}>
              <select
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                onChange={(e) =>
                  setCapabilities(capabilities.map((x, i) => (i === idx ? { ...x, domain: e.target.value } : x)))
                }
                value={c.domain}
              >
                {DOMAIN_POOL.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="priority" compact span={1}>
              <select
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                onChange={(e) =>
                  setCapabilities(
                    capabilities.map((x, i) => (i === idx ? { ...x, priority: e.target.value as CapabilityPriority } : x))
                  )
                }
                value={c.priority}
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="col-span-1 flex items-end">
              <button
                className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:border-rose-400 hover:text-rose-700"
                onClick={() => setCapabilities(capabilities.filter((_, i) => i !== idx))}
                type="button"
              >
                删
              </button>
            </div>
            <div className="col-span-12">
              <Field label="value_statement (谁 + 通过什么 + 达到什么目的)" required compact>
                <input
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  onChange={(e) =>
                    setCapabilities(capabilities.map((x, i) => (i === idx ? { ...x, value_statement: e.target.value } : x)))
                  }
                  placeholder="销售通过 ERP 录入已购课学员, 建立学籍主数据"
                  value={c.value_statement}
                />
              </Field>
            </div>
            <div className="col-span-6">
              <Field label="参与 actor (≥1, 多选)" required compact>
                <MultiSelect
                  options={actors.map((a) => ({ value: a.id, label: `${a.id} - ${a.name}` }))}
                  selected={c.actor_ids}
                  onChange={(arr) =>
                    setCapabilities(capabilities.map((x, i) => (i === idx ? { ...x, actor_ids: arr } : x)))
                  }
                />
              </Field>
            </div>
            <div className="col-span-6">
              <Field label="涉及 entity (多选)" compact>
                <MultiSelect
                  options={entities.map((e) => ({ value: e.name, label: e.name }))}
                  selected={c.entity_ids}
                  onChange={(arr) =>
                    setCapabilities(capabilities.map((x, i) => (i === idx ? { ...x, entity_ids: arr } : x)))
                  }
                />
              </Field>
            </div>
          </div>
        </div>
      ))}
      <button
        className="rounded border border-dashed border-slate-300 px-3 py-2 text-[12px] text-slate-600 hover:border-slate-500 hover:text-slate-900"
        onClick={add}
        type="button"
      >
        + 添加 Capability
      </button>
    </div>
  );
}

/* ============================================================
 *  Step 5 — Function
 * ============================================================ */
function Step5({
  functions,
  setFunctions,
  capabilities,
  actors,
  entities
}: {
  functions: FunctionInput[];
  setFunctions: (f: FunctionInput[]) => void;
  capabilities: CapabilityInput[];
  actors: ActorInput[];
  entities: EntityInput[];
}) {
  const add = () =>
    setFunctions([
      ...functions,
      {
        id: "",
        name: "",
        module: "",
        capability_id: capabilities[0]?.id ?? "",
        actor_ids: [],
        entities_touched: []
      }
    ]);
  return (
    <div className="space-y-4">
      <Hint>
        Function 是具体能力点。 每个 function 必须有 capability_id 归属 + actor_ids + module (物理目录)。 可以跳过本步 — 后续在主工作台 markmap 上补建。
      </Hint>
      {functions.map((f, idx) => (
        <div key={idx} className="rounded border border-slate-200 bg-white p-3">
          <div className="grid grid-cols-12 gap-2">
            <Field label="id" required compact span={3}>
              <input
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm font-mono"
                onChange={(e) =>
                  setFunctions(functions.map((x, i) => (i === idx ? { ...x, id: e.target.value } : x)))
                }
                placeholder="student-intake"
                value={f.id}
              />
            </Field>
            <Field label="name" required compact span={3}>
              <input
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                onChange={(e) =>
                  setFunctions(functions.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                }
                placeholder="学员录入"
                value={f.name}
              />
            </Field>
            <Field label="module (物理目录)" required compact span={2}>
              <input
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm font-mono"
                onChange={(e) =>
                  setFunctions(functions.map((x, i) => (i === idx ? { ...x, module: e.target.value } : x)))
                }
                placeholder="sales"
                value={f.module}
              />
            </Field>
            <Field label="capability_id" required compact span={3}>
              <select
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                onChange={(e) =>
                  setFunctions(functions.map((x, i) => (i === idx ? { ...x, capability_id: e.target.value } : x)))
                }
                value={f.capability_id}
              >
                <option value="">(选择)</option>
                {capabilities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} - {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="col-span-1 flex items-end">
              <button
                className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:border-rose-400 hover:text-rose-700"
                onClick={() => setFunctions(functions.filter((_, i) => i !== idx))}
                type="button"
              >
                删
              </button>
            </div>
            <div className="col-span-6">
              <Field label="actor_ids (≥1)" required compact>
                <MultiSelect
                  options={actors.map((a) => ({ value: a.id, label: `${a.id} - ${a.name}` }))}
                  selected={f.actor_ids}
                  onChange={(arr) =>
                    setFunctions(functions.map((x, i) => (i === idx ? { ...x, actor_ids: arr } : x)))
                  }
                />
              </Field>
            </div>
            <div className="col-span-6">
              <Field label="entities_touched (可选)" compact>
                <MultiSelect
                  options={entities.map((e) => ({ value: e.name, label: e.name }))}
                  selected={f.entities_touched}
                  onChange={(arr) =>
                    setFunctions(functions.map((x, i) => (i === idx ? { ...x, entities_touched: arr } : x)))
                  }
                />
              </Field>
            </div>
          </div>
        </div>
      ))}
      <button
        className="rounded border border-dashed border-slate-300 px-3 py-2 text-[12px] text-slate-600 hover:border-slate-500 hover:text-slate-900"
        onClick={add}
        type="button"
      >
        + 添加 Function
      </button>
    </div>
  );
}

/* ============================================================
 *  Step 6 — 总览 + 一致性
 * ============================================================ */
function Step6({
  project,
  actors,
  entities,
  capabilities,
  functions,
  modules
}: {
  project: ProjectInput;
  actors: ActorInput[];
  entities: EntityInput[];
  capabilities: CapabilityInput[];
  functions: FunctionInput[];
  modules: { id: string; name: string }[];
}) {
  // 一致性检查
  const orphanActors = actors.filter(
    (a) => !capabilities.some((c) => c.actor_ids.includes(a.id))
  );
  const orphanEntities = entities.filter(
    (e) => !capabilities.some((c) => c.entity_ids.includes(e.name))
  );
  const emptyCapabilities = capabilities.filter(
    (c) => !functions.some((f) => f.capability_id === c.id)
  );
  const overflowCapabilities = capabilities.filter(
    (c) => functions.filter((f) => f.capability_id === c.id).length > 10
  );
  return (
    <div className="space-y-5">
      <Hint>检查 Wizard 输出的一致性。 黄色提示不阻塞落盘, 但建议先回到对应步骤修复。</Hint>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">📦 落盘清单</h3>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
          <Stat label="产品 id" value={project.id || "(未填)"} />
          <Stat label="产品 name" value={project.name || "(未填)"} />
          <Stat label="Actor" value={`${actors.length}`} />
          <Stat label="Entity" value={`${entities.length}`} />
          <Stat label="Capability" value={`${capabilities.length}`} />
          <Stat label="Function" value={`${functions.length}`} />
          <Stat label="Module(推导)" value={`${modules.length}`} />
        </dl>
      </section>

      {(orphanActors.length > 0 || orphanEntities.length > 0 || emptyCapabilities.length > 0 || overflowCapabilities.length > 0) ? (
        <section className="rounded-md border border-amber-200 bg-amber-50/40 p-4">
          <h3 className="text-sm font-semibold text-amber-900">⚠ 一致性提示</h3>
          <ul className="mt-2 space-y-1 text-[12px] text-amber-900">
            {orphanActors.length > 0 ? (
              <li>
                <span className="font-medium">{orphanActors.length} 个孤儿 actor</span> 未在任何 capability.actor_ids 中:
                {" "}
                {orphanActors.map((a) => a.id).join(", ")}
              </li>
            ) : null}
            {orphanEntities.length > 0 ? (
              <li>
                <span className="font-medium">{orphanEntities.length} 个孤儿 entity</span> 未在任何 capability.entity_ids 中:
                {" "}
                {orphanEntities.map((e) => e.name).join(", ")}
              </li>
            ) : null}
            {emptyCapabilities.length > 0 ? (
              <li>
                <span className="font-medium">{emptyCapabilities.length} 个空 capability</span> 下没有 function:
                {" "}
                {emptyCapabilities.map((c) => c.id).join(", ")}
              </li>
            ) : null}
            {overflowCapabilities.length > 0 ? (
              <li>
                <span className="font-medium">{overflowCapabilities.length} 个 capability 粒度过粗</span> (function 数 &gt; 10):
                {" "}
                {overflowCapabilities.map((c) => c.id).join(", ")}
              </li>
            ) : null}
          </ul>
        </section>
      ) : (
        <section className="rounded-md border border-emerald-200 bg-emerald-50/60 p-4 text-[12px] text-emerald-900">
          ✅ 一致性检查通过
        </section>
      )}
    </div>
  );
}

/* ============================================================
 *  共用小组件
 * ============================================================ */
function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2 text-[11px] leading-5 text-blue-900">
      💡 {children}
    </div>
  );
}

/** 静态映射, 避免 Tailwind JIT 漏抓动态类名 */
const SPAN_CLS: Record<number, string> = {
  1: "col-span-1",
  2: "col-span-2",
  3: "col-span-3",
  4: "col-span-4",
  5: "col-span-5",
  6: "col-span-6",
  12: "col-span-12"
};

function Field({
  label,
  required,
  compact,
  span,
  children
}: {
  label: string;
  required?: boolean;
  compact?: boolean;
  span?: number;
  children: React.ReactNode;
}) {
  const cls = span ? SPAN_CLS[span] ?? "" : "";
  return (
    <div className={cls}>
      <div className={`${compact ? "text-[10px]" : "text-[11px]"} ${required ? "text-slate-700" : "text-slate-500"}`}>
        {label}
        {required ? <span className="ml-1 text-rose-500">*</span> : null}
      </div>
      <div className={compact ? "mt-0.5" : "mt-1"}>{children}</div>
    </div>
  );
}

function StringListField({
  label,
  placeholder,
  items,
  onChange
}: {
  label: string;
  placeholder: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  return (
    <div>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-1 space-y-1">
        {items.map((s, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={placeholder}
              value={s}
            />
            <button
              className="text-slate-400 hover:text-rose-600"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              type="button"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="text-[11px] text-slate-500 hover:text-slate-900"
          onClick={() => onChange([...items, ""])}
          type="button"
        >
          + 添加一条
        </button>
      </div>
    </div>
  );
}

function MultiSelect({
  options,
  selected,
  onChange
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  if (options.length === 0) {
    return <div className="text-[11px] italic text-slate-400">(暂无可选项, 先回到对应 step 添加)</div>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const sel = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            className={`rounded border px-2 py-0.5 text-[11px] ${
              sel
                ? "border-emerald-500 bg-emerald-100 text-emerald-900"
                : "border-slate-300 bg-white text-slate-600 hover:border-slate-500"
            }`}
            onClick={() => {
              if (sel) {
                onChange(selected.filter((s) => s !== o.value));
              } else {
                onChange([...selected, o.value]);
              }
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] text-slate-500">{label}</dt>
      <dd className="text-[13px] font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

/* ============================================================
 *  步骤校验
 * ============================================================ */
function stepValid(
  step: StepKey,
  state: {
    project: ProjectInput;
    actors: ActorInput[];
    entities: EntityInput[];
    capabilities: CapabilityInput[];
    functions: FunctionInput[];
    modules: { id: string; name: string }[];
  }
): boolean {
  const { project, actors, entities, capabilities, functions } = state;
  switch (step) {
    case 1:
      return Boolean(project.id) && /^[a-z][a-z0-9-]*$/.test(project.id) && Boolean(project.name);
    case 2:
      return actors.length > 0 && actors.every((a) => /^[a-z][a-z0-9-]*$/.test(a.id) && a.name);
    case 3:
      // entities 可空, 但若填了必须 PascalCase
      return entities.every((e) => !e.name || /^[A-Z][A-Za-z0-9]*$/.test(e.name));
    case 4:
      return (
        capabilities.length > 0 &&
        capabilities.every(
          (c) =>
            /^[a-z][a-z0-9-]*$/.test(c.id) &&
            c.name &&
            c.domain &&
            c.value_statement &&
            c.actor_ids.length > 0
        )
      );
    case 5:
      // Function 可选, 但每条必须满足约束
      return functions.every(
        (f) =>
          /^[a-z][a-z0-9-]*$/.test(f.id) &&
          f.name &&
          f.module &&
          f.capability_id &&
          f.actor_ids.length > 0
      );
    case 6:
      // 落盘前最低要求: project ok + 至少 1 actor + 至少 1 capability
      return (
        /^[a-z][a-z0-9-]*$/.test(project.id) &&
        Boolean(project.name) &&
        actors.length > 0 &&
        capabilities.length > 0
      );
  }
}
