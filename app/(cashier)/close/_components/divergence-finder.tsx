import type { Suggestion } from "@/lib/reconciliation/heuristics";

interface Props {
  suggestions: Suggestion[];
}

const KIND_ICON: Record<Suggestion["kind"], string> = {
  equal_opposite: "🔀",
  outlier: "📈",
  decimal_typo: "🔢",
  orphan: "👤",
};

export function DivergenceFinder({ suggestions }: Props) {
  if (suggestions.length === 0) {
    return (
      <div className="bg-[var(--color-panel)] border border-green-900 rounded-lg p-3 text-sm text-green-500">
        ✓ No suspicious patterns detected.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {suggestions.map((s, i) => (
        <div key={i} className="bg-cyan-500/5 border border-cyan-700 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span>{KIND_ICON[s.kind]}</span>
            <span className="font-semibold text-cyan-300 text-sm">{s.title}</span>
          </div>
          <div className="text-xs text-slate-400">{s.body}</div>
          {s.txIds.length > 0 && (
            <div className="text-[0.7rem] text-slate-600 mt-1 font-mono">
              tx: {s.txIds.slice(0, 4).join(", ")}{s.txIds.length > 4 && ` +${s.txIds.length - 4} more`}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
