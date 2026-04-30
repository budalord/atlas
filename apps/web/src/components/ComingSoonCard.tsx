import type { LucideIcon } from "lucide-react";

interface ComingSoonCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export function ComingSoonCard({ icon: Icon, title, description }: ComingSoonCardProps) {
  return (
    <section className="border-t border-slate-200 bg-white p-6">
      <div className="flex items-start gap-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white text-slate-500 ring-1 ring-slate-200">
          <Icon size={20} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
            <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">即将开放</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
        </div>
      </div>
    </section>
  );
}
