import { useEffect, useMemo, useState } from "react";
import { renderMermaid } from "../lib/mermaid";

interface MermaidBlockProps {
  code: string;
}

export function MermaidBlock({ code }: MermaidBlockProps) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useMemo(() => `atlas-mermaid-${Math.random().toString(36).slice(2)}`, []);

  useEffect(() => {
    let cancelled = false;

    renderMermaid(code, id)
      .then((nextSvg) => {
        if (!cancelled) {
          setSvg(nextSvg);
          setError(null);
        }
      })
      .catch((renderError) => {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : "Mermaid render failed");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (error) {
    return <pre className="overflow-auto rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</pre>;
  }

  return (
    <div
      className="overflow-auto rounded border border-slate-200 bg-white p-4"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
