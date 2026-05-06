"use client";

import { useState, useTransition, type FormEvent } from "react";

export interface UseFormActionOpts {
  /** Called after the action resolves successfully. */
  onSuccess?: (formData: FormData) => void;
  /** Called when the action throws. Default: capture as string into `error`. */
  onError?: (err: unknown) => void;
}

/**
 * Wraps a Server Action that takes FormData with client-side error capture and a success hook.
 *
 * Usage:
 *   const { onSubmit, pending, error } = useFormAction(recordBuyIn, {
 *     onSuccess: (fd) => { toast.show(`Buy-in $${fd.get("amount")} recorded`); close(); }
 *   });
 *   <form onSubmit={onSubmit}>...</form>
 */
export function useFormAction<T>(
  action: (formData: FormData) => Promise<T>,
  opts: UseFormActionOpts = {}
) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      try {
        await action(fd);
        opts.onSuccess?.(fd);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        opts.onError?.(err);
      }
    });
  };

  return { onSubmit, pending, error };
}
