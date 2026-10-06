import { z } from "zod";

const goalId = z.uuid({ error: "month.errors.invalid" });

export const setRhythmSchema = z.object({
  goalId,
  // Minutes a month, the unit `goals.rhythm` is checked in.
  amount: z
    .number({ error: "roadmap.errors.rhythmRange" })
    .int({ error: "roadmap.errors.rhythmRange" })
    .min(1, { error: "roadmap.errors.rhythmRange" })
    .max(1_000_000, { error: "roadmap.errors.rhythmRange" }),
});

export type SetRhythmInput = z.infer<typeof setRhythmSchema>;

export const dismissPlanNoticeSchema = z.object({
  goalId,
  month: z
    .string({ error: "month.errors.monthInvalid" })
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: "month.errors.monthInvalid" }),
});

export type DismissPlanNoticeInput = z.infer<typeof dismissPlanNoticeSchema>;

