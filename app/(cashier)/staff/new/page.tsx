import { createStaff } from "../../_actions/staff";
import { SubmitButton } from "@/components/submit-button";

export default function NewStaffPage() {
  return (
    <div className="max-w-md">
      <h2 className="text-lg font-semibold mb-4">New Staff</h2>
      <form action={createStaff} className="flex flex-col gap-3 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Name</span>
          <input name="name" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Role</span>
          <select name="role" required defaultValue="DEALER" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="DEALER">Dealer</option>
            <option value="WAITRESS">Waitress</option>
            <option value="RUNNER">Runner</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="useDefaultTax" defaultChecked />
          <span className="text-slate-400">Use system default tip tax rate (20%)</span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Custom tip tax rate (%)</span>
          <input name="tipTaxRate" type="number" min="0" max="100" step="1" placeholder="e.g. 15" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <SubmitButton>Create</SubmitButton>
      </form>
    </div>
  );
}
