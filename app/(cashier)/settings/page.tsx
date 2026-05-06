import { DenominationToggle } from "./_components/denomination-toggle";

export default function SettingsPage() {
  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold mb-4">Settings</h2>
      <p className="text-xs text-slate-500 mb-4">
        These settings are stored in this browser's local storage and don't sync across devices.
      </p>
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
        <DenominationToggle />
      </div>
    </div>
  );
}
