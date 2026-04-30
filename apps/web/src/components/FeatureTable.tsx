import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import {
  groupFeatures,
  shouldDefaultExpand,
  statusDistribution,
  type FeatureGroup
} from "../lib/featureGrouping";
import { featureLevelPrompt } from "../lib/promptTemplates";
import type { FeatureSpec } from "../types";
import { CopyPromptButton } from "./CopyPromptButton";

interface FeatureTableProps {
  features: FeatureSpec[];
  productId: string;
}

export function FeatureTable({ features, productId }: FeatureTableProps) {
  const groups = useMemo(() => groupFeatures(features), [features]);

  const defaultOpen = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const g of groups) {
      map[g.key] = shouldDefaultExpand(g.features);
    }
    return map;
  }, [groups]);

  const [openMap, setOpenMap] = useState<Record<string, boolean>>(defaultOpen);
  // 当 features 变化(切换产品)时,重置展开状态为该产品默认值
  const [lastFeaturesRef, setLastFeaturesRef] = useState<FeatureSpec[]>(features);
  if (lastFeaturesRef !== features) {
    setLastFeaturesRef(features);
    setOpenMap(defaultOpen);
  }

  function toggleGroup(key: string) {
    setOpenMap((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function expandAll() {
    const next: Record<string, boolean> = {};
    for (const g of groups) next[g.key] = true;
    setOpenMap(next);
  }

  function collapseAll() {
    const next: Record<string, boolean> = {};
    for (const g of groups) next[g.key] = false;
    setOpenMap(next);
  }

  const allOpen = groups.length > 0 && groups.every((g) => openMap[g.key]);

  if (features.length === 0) {
    return <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">暂无功能点</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span>
          共 <span className="font-semibold text-slate-900">{features.length}</span> 个功能,分为{" "}
          <span className="font-semibold text-slate-900">{groups.length}</span> 组
        </span>
        <button
          type="button"
          onClick={allOpen ? collapseAll : expandAll}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 transition hover:bg-slate-50"
        >
          {allOpen ? "全部折叠" : "全部展开"}
        </button>
      </div>

      <div className="space-y-2">
        {groups.map((group) => (
          <FeatureGroupPanel
            key={group.key}
            group={group}
            productId={productId}
            open={!!openMap[group.key]}
            onToggle={() => toggleGroup(group.key)}
          />
        ))}
      </div>
    </div>
  );
}

interface FeatureGroupPanelProps {
  group: FeatureGroup;
  productId: string;
  open: boolean;
  onToggle: () => void;
}

function FeatureGroupPanel({ group, productId, open, onToggle }: FeatureGroupPanelProps) {
  const distribution = useMemo(() => statusDistribution(group.features), [group.features]);

  const groupPrompt = useMemo(
    () => group.features.map((f) => featureLevelPrompt(productId, f)).join("\n\n"),
    [group.features, productId]
  );

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="flex items-center gap-3 bg-slate-50 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown size={14} className="shrink-0 text-slate-500" />
          ) : (
            <ChevronRight size={14} className="shrink-0 text-slate-500" />
          )}
          <span className={`font-mono text-xs ${group.isUngrouped ? "text-slate-500 italic" : "text-slate-900"}`}>
            {group.label}
          </span>
          <span className="text-xs text-slate-500">{group.features.length} 个功能</span>
          {distribution && (
            <span className="text-xs text-slate-400">·</span>
          )}
          {distribution && (
            <span className="text-xs text-slate-500">{distribution}</span>
          )}
        </button>
        <CopyPromptButton label="复制本页全部指令" prompt={groupPrompt} size="sm" />
      </div>

      {open && (
        <div className="overflow-x-auto border-t border-slate-200">
          <table className="min-w-[860px] table-fixed border-collapse text-sm">
            <thead className="bg-white text-left text-xs font-semibold uppercase text-slate-600">
              <tr>
                <th className="w-20 px-3 py-2">ID</th>
                <th className="px-3 py-2">描述</th>
                <th className="w-24 px-3 py-2">状态</th>
                <th className="w-20 px-3 py-2">优先级</th>
                <th className="w-40 px-3 py-2">接口</th>
                <th className="px-3 py-2">备注</th>
                <th className="w-24 px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {group.features.map((feature) => (
                <tr key={feature.id}>
                  <td className="px-3 py-3 font-mono text-xs text-slate-600">{feature.id}</td>
                  <td className="px-3 py-3 text-slate-900">{feature.description}</td>
                  <td className="px-3 py-3 text-slate-700">{feature.status}</td>
                  <td className="px-3 py-3 text-slate-700">{feature.priority}</td>
                  <td className="break-words px-3 py-3 font-mono text-xs text-slate-700">{feature.endpoint}</td>
                  <td className="px-3 py-3 text-slate-600">{feature.notes}</td>
                  <td className="px-3 py-3">
                    <CopyPromptButton
                      label="指令"
                      prompt={featureLevelPrompt(productId, feature)}
                      size="sm"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
