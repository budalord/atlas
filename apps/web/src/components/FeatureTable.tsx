import { featureLevelPrompt } from "../lib/promptTemplates";
import type { FeatureSpec } from "../types";
import { CopyPromptButton } from "./CopyPromptButton";

interface FeatureTableProps {
  features: FeatureSpec[];
  productId: string;
}

export function FeatureTable({ features, productId }: FeatureTableProps) {
  if (features.length === 0) {
    return <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">暂无功能点</div>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="min-w-[860px] table-fixed border-collapse text-sm">
        <thead className="bg-slate-100 text-left text-xs font-semibold uppercase text-slate-600">
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
          {features.map((feature) => (
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
  );
}
