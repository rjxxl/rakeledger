"use server";

import { revalidatePath } from "next/cache";
import Decimal from "decimal.js";
import { z } from "zod";
import { correctTransaction } from "@/lib/ledger/correct";
import { parseFormData } from "@/lib/validation/transactions";
import { getCashierUserId } from "./_cashier";
import type { PaymentMethod } from "@prisma/client";

// Empty strings from blank form inputs are treated as "no override" (undefined).
const optionalString = z.preprocess(
  (v) => (typeof v === "string" && v.length === 0 ? undefined : v),
  z.string().optional()
);
const optionalAmount = z.preprocess(
  (v) => (typeof v === "string" && v.length === 0 ? undefined : v),
  z.string().regex(/^\d+(\.\d+)?$/).optional()
);
const optionalMethod = z.preprocess(
  (v) => (typeof v === "string" && v.length === 0 ? undefined : v),
  z.enum(["CASH", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY", "OTHER"]).optional()
);

const correctionSchema = z.object({
  originalId: z.string().min(1),
  reason: z.string().min(1),
  amount: optionalAmount,
  method: optionalMethod,
  playerId: optionalString,
  tableId: optionalString,
  staffId: optionalString,
  note: optionalString,
});

export async function submitCorrection(formData: FormData): Promise<void> {
  const input = parseFormData(correctionSchema, formData);
  const cashierId = await getCashierUserId();

  await correctTransaction({
    originalId: input.originalId,
    reversedById: cashierId,
    reason: input.reason,
    overrides: {
      amount: input.amount ? new Decimal(input.amount) : undefined,
      method: input.method as PaymentMethod | undefined,
      playerId: input.playerId,
      tableId: input.tableId,
      staffId: input.staffId,
      note: input.note,
    },
  });

  revalidatePath("/live");
}
