"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button that disables itself while the form's server action is pending.
 * Prevents the double-submit bug where a rapid second click fires the action twice.
 *
 * Uses React 19's useFormStatus, which reads the pending state of the nearest
 * enclosing <form> — works fine inside a server-rendered form because this is
 * a thin client-component boundary.
 *
 * Props:
 *   children     — label shown when idle (e.g. "Create")
 *   pendingLabel — label shown while submitting (default "Creating…")
 *   className    — override the default amber styling
 */
export function SubmitButton({
  children,
  pendingLabel = "Creating…",
  className = "bg-amber-500 text-black font-semibold rounded px-4 py-2 disabled:opacity-50",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}
