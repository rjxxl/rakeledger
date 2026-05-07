"use server";

import { getActiveUserId } from "@/lib/active-user";

/**
 * Returns the active user's ID. Backward-compatible name retained from Plan 1
 * to avoid touching every Server Action; the underlying lookup now uses the
 * Auth.js session instead of a hardcoded email.
 */
export async function getCashierUserId(): Promise<string> {
  return getActiveUserId();
}
