import { useMemo, useState } from "react";
import type { ApiEnvelope, FeaturePoint, RolesRegistry } from "../types";

interface RolesEditorProps {
  productId: string;
  featureId: string;
  /** 当前已选 role id 列表(从 feature.roles 来) */
  roles: string[];
  /** 全局角色注册表;尚未加载完时为 null */
  registry: RolesRegistry | null;
  readOnly?: boolean;
  onSaved?: (updated: FeaturePoint) => void;
}

/**
 * 功能点角色多选编辑器。view 态显示 chip 列表;edit 态显示 registry 全量复选框 + 保存/取消。
 * 保存调用 PATCH /api/products/:id/features/:fid/roles,失败时显示错误,view 态保留原值。
 */
export function RolesEditor({
  productId,
  featureId,
  roles,
  registry,
  readOnly = false,
  onSaved
}: RolesEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(roles);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 用于查 id → name 显示
  const idToName = useMemo(() => {
    const map = new Map<string, string>();
    registry?.roles.forEach((r) => map.set(r.id, r.name));
    return map;
  }, [registry]);

  const beginEdit = () => {
    setDraft(roles);
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const toggleDraft = (id: string) => {
    setDraft((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/products/${productId}/features/${featureId}/roles`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roles: draft })
        }
      );
      const json = (await res.json()) as ApiEnvelope<FeaturePoint> & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      onSaved?.(json.data);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-md border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900">
        <span>
          角色
          <span className="ml-2 text-[11px] font-normal text-slate-400">
            ({roles.length}/{registry?.roles.length ?? "—"})
          </span>
        </span>
        {!readOnly && !editing ? (
          <button
            type="button"
            className="rounded border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
            onClick={beginEdit}
            disabled={!registry}
            title={registry ? "编辑角色" : "角色注册表加载中..."}
          >
            编辑
          </button>
        ) : null}
      </header>
      <div className="px-4 py-3">
        {!editing ? (
          roles.length === 0 ? (
            <div className="text-xs italic text-slate-400">
              (未指定;角色描述"谁参与"该功能点,留空代表 Agent 生成流程图时需自己推断)
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {roles.map((id) => {
                const name = idToName.get(id);
                return (
                  <span
                    key={id}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                      name
                        ? "border-slate-200 bg-slate-50 text-slate-700"
                        : "border-rose-200 bg-rose-50 text-rose-700"
                    }`}
                    title={name ? `id: ${id}` : `id "${id}" 不在 data/roles.yml 中`}
                  >
                    {name ? name : `${id} ⚠`}
                  </span>
                );
              })}
            </div>
          )
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {registry?.roles.map((r) => {
                const checked = draft.includes(r.id);
                return (
                  <label
                    key={r.id}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${
                      checked
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                    title={r.note}
                  >
                    <input
                      type="checkbox"
                      className="h-3 w-3"
                      checked={checked}
                      onChange={() => toggleDraft(r.id)}
                    />
                    {r.name}
                  </label>
                );
              })}
            </div>
            {error ? (
              <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
                {error}
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded bg-slate-900 px-3 py-1 text-[11px] font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving ? "保存中..." : "保存"}
              </button>
              <button
                type="button"
                className="rounded border border-slate-200 px-3 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                onClick={cancelEdit}
                disabled={saving}
              >
                取消
              </button>
              <span className="text-[11px] text-slate-400">
                编辑选项来自 data/roles.yml(全局共享)
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
