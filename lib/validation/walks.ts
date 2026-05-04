import { z } from "zod";

const decimalString = z.string().regex(/^\d+(\.\d+)?$/).refine((s) => parseFloat(s) > 0, "Must be positive");

export const chipWalkSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  amount: decimalString,
  note: z.string().max(200).optional(),
});

export const chipReturnSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  amount: decimalString,
  matchesWalkId: z.string().optional(),
});
