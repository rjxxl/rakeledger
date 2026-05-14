import { createPlayer } from "../../_actions/players";
import { SubmitButton } from "@/components/submit-button";

export default function NewPlayerPage() {
  return (
    <div className="max-w-md">
      <h2 className="text-lg font-semibold mb-4">New Player</h2>
      <form action={createPlayer} className="flex flex-col gap-3 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Display name</span>
          <input name="displayName" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Phone (optional)</span>
          <input name="phone" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Notes</span>
          <textarea name="notes" rows={3} className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <SubmitButton>Create</SubmitButton>
      </form>
    </div>
  );
}
