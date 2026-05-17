import { useMemo, useState } from "react";
import { useIntakeStore } from "../stores/intakeStore";
import type { IntakeListItem, ProductTheme } from "../types";

const ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const THEMES: Array<ProductTheme | "other"> = ["erp", "miniapp", "seo", "tool", "other"];

interface IntakeFormProps {
  onCreated: (item: IntakeListItem) => void;
}

/**
 * 录入新产品的基础表单 (id / name / source_path / theme)。
 * 始终展开,由外层(NewProductModal)控制可见性。提交后调 POST /api/intake/start。
 */
export function IntakeForm({ onCreated }: IntakeFormProps) {
  const start = useIntakeStore((s) => s.start);
  const list = useIntakeStore((s) => s.list);

  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [theme, setTheme] = useState<ProductTheme | "other">("tool");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const idError = useMemo(() => {
    if (!id) return null;
    if (!ID_RE.test(id)) return "id 必须是小写 kebab-case (a-z0-9-)";
    if (list.some((item) => item.id === id)) return "id 已被其它录入占用";
    return null;
  }, [id, list]);

  const canSubmit = !!id && !!name && !!sourcePath && !idError && !submitting;

  async function onSubmit() {
    setServerError(null);
    setSubmitting(true);
    try {
      const item = await start({ id, name, source_path: sourcePath, theme });
      setId("");
      setName("");
      setSourcePath("");
      setTheme("tool");
      onCreated(item);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field error={idError} label="id (kebab-case)">
          <input
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-950 focus:outline-none"
            onChange={(e) => setId(e.target.value.trim())}
            placeholder="my-product"
            value={id}
          />
        </Field>
        <Field label="name (中文显示名)">
          <input
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-950 focus:outline-none"
            onChange={(e) => setName(e.target.value)}
            placeholder="我的产品"
            value={name}
          />
        </Field>
        <Field label="source_path (项目绝对路径)">
          <input
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-slate-950 focus:outline-none"
            onChange={(e) => setSourcePath(e.target.value.trim())}
            placeholder="/Users/you/projects/my-product"
            value={sourcePath}
          />
        </Field>
        <Field label="theme">
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-slate-950 focus:outline-none"
            onChange={(e) => setTheme(e.target.value as ProductTheme | "other")}
            value={theme}
          >
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {serverError ? (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {serverError}
        </div>
      ) : null}

      <div className="mt-3">
        <button
          className="w-full rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={!canSubmit}
          onClick={onSubmit}
          type="button"
        >
          {submitting ? "提交中..." : "开始录入"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-700">{label}</div>
      {children}
      {error ? <div className="mt-1 text-xs text-rose-600">{error}</div> : null}
    </div>
  );
}
