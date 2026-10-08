import type { ReviewWeek } from "@/lib/day/types";
import type { MonthRow } from "@/lib/plan/months";

export type CarriedReport = {
  name: string;
  note: string | null;
  from: string;
  owes: number;
  hasAmount: boolean;
  children: { name: string; note: string | null; owes: number; hasAmount: boolean }[];
};

export type ReportTask = {
  name: string;
  from: string | null;
  done: boolean;
  doneOn: string | null;
  estimate: number | null;
  owes: number;
  hasAmount: boolean;
  note: string | null;
  children: { name: string; done: boolean; doneOn: string | null; estimate: number | null; note: string | null }[];
};

export type WeekSplit = { index: number; month: string; startsOn: string; endsOn: string; total: number };

export type GoalReport = {
  id: string;
  name: string;
  horizon: string;
  endedOn: string | null;
  unit: string | null;
  thisMonth: { planned: number | null; reached: number; underPace: boolean };
  toDate: { planned: number; reached: number };
  phases: { aim: string; startsOn: string; endsOn: string; current: boolean }[];
  tasks: ReportTask[];
  carried: CarriedReport[];
  months: (MonthRow & { carried: number | null })[];
  weeks: ReviewWeek[];
  // The current week's planned minutes (RP-58); null when it has no amount.
  weekPlanned?: number | null;
  // A week crossing two months, cut at the month's edge: each part holds the
  // week's days that fall in `month` (the first of it), so a month's parts add up to it.
  weekSplits: WeekSplit[];
};

export type Report = {
  today: string;
  evidence: "read" | "unreadable";
  goals: GoalReport[];
};
