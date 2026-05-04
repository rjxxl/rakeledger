import { z } from "zod";

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, "Must be a positive decimal").refine(
  (s) => parseFloat(s) > 0,
  "Must be greater than zero"
);

const methodEnum = z.enum(["CASH", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY", "OTHER"]);

/** Optional FK field: empty string from an HTML select treated as null */
const optionalId = z.string().optional().transform(v => (v && v.length > 0 ? v : null));

export const buyInSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  amount: decimalString,
  method: methodEnum,
  tableId: optionalId,
});

export const cashOutSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  method: methodEnum,
  tableId: optionalId,
  n100: z.coerce.number().int().nonnegative().default(0),
  n25: z.coerce.number().int().nonnegative().default(0),
  n5: z.coerce.number().int().nonnegative().default(0),
  n1: z.coerce.number().int().nonnegative().default(0),
}).refine(
  (v) => v.n100 + v.n25 + v.n5 + v.n1 > 0,
  "Cash-out total must be greater than zero"
);

export const rakeSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  staffId: optionalId,
  tableId: optionalId,
  amount: decimalString,
});

export const tipDropSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  staffId: z.string().min(1),
  tableId: optionalId,
  amount: decimalString,
});

export const markerIssueSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  amount: decimalString,
  collateral: z.string().optional().transform(v => v || null),
});

export const markerRepaySchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  markerId: z.string().min(1),
  amount: decimalString,
  method: methodEnum,
});

/** Helper: validate FormData against a schema, return parsed values. */
export function parseFormData<T extends z.ZodTypeAny>(schema: T, formData: FormData): z.infer<T> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    obj[key] = value.toString();
  }
  return schema.parse(obj);
}

export const tournamentFeeSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Must be a positive decimal").refine((s) => parseFloat(s) > 0, "Must be > 0"),
  method: methodEnum,
});

export const tournamentPayoutSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/).refine((s) => parseFloat(s) > 0),
  method: methodEnum,
});

export const jackpotPayoutSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/).refine((s) => parseFloat(s) > 0),
  paidIn: z.enum(["CHIPS", "CASH"]),
  reason: z.string().min(1).max(100),
});

export const freerollPrizeSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/).refine((s) => parseFloat(s) > 0),
  freerollName: z.string().max(80).optional(),
});

export const staffAdvanceSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  staffId: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/).refine((s) => parseFloat(s) > 0),
  note: z.string().min(1).max(200),
});

export const fnbCostSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/).refine((s) => parseFloat(s) > 0),
  note: z.string().min(1).max(200),
});

export const drawerAdjustSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  amount: z.string().regex(/^-?\d+(\.\d+)?$/, "Must be a signed decimal").refine((s) => parseFloat(s) !== 0, "Cannot be zero"),
  note: z.string().min(1).max(200),
});

export const chipFloatAdjustSchema = drawerAdjustSchema;
