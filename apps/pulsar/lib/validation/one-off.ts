import { z } from "zod";

import { isCivilDate, todayInZone } from "@/lib/zone";

// A day the person named for their errand, never one already gone: a past
// one is refused (RP-19). Today is read at parse time, not at import.
const civilDate = (message: string) => z.string().refine(isCivilDate, { error: message });
const futureOrToday = (day: string) => day >= todayInZone();
const oneOffDay = () =>
  civilDate("day.errors.oneOffDayInvalid").refine(futureOrToday, {
    error: "day.errors.oneOffDayPast",
  });

export const createOneOffSchema = z.object({
  name: z
    .string({ error: "day.errors.oneOffNameEmpty" })
    .trim()
    .min(1, { error: "day.errors.oneOffNameEmpty" })
    .max(120, { error: "day.errors.oneOffNameTooLong" }),
  // Null is a one-off with no day yet (RP-21), dated later by `scheduleOneOff`.
  day: oneOffDay().nullable(),
  // Absent, a one-off belongs to nothing (RP-20) and its week is still shown.
  goalId: z.uuid({ error: "plan.errors.goalInvalid" }).nullish(),
});

export type CreateOneOffInput = z.infer<typeof createOneOffSchema>;

export const scheduleOneOffSchema = z.object({
  oneOffId: z.uuid({ error: "day.errors.invalid" }),
  day: oneOffDay(),
});

export type ScheduleOneOffInput = z.infer<typeof scheduleOneOffSchema>;

export const completeOneOffSchema = z.object({
  oneOffId: z.uuid({ error: "day.errors.invalid" }),
});

export type CompleteOneOffInput = z.infer<typeof completeOneOffSchema>;

export const deleteOneOffSchema = z.object({
  oneOffId: z.uuid({ error: "day.errors.invalid" }),
});

export type DeleteOneOffInput = z.infer<typeof deleteOneOffSchema>;
