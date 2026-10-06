import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import { errorOf } from "@/lib/mcp/errors";
import { shapeDay, shapeGoal, shapeGoalList, shapeLoose, shapeMonth, shapeReport } from "@/lib/mcp/shape";
import type { ResolvedPerson } from "@/lib/mcp/tokens";
import { planMonthList } from "@/lib/plan/roadmap-read";
import { loadDay } from "@/lib/queries/day";
import { listGoalsForMetas, loadGoal } from "@/lib/queries/goal";
import { listDaylessOneOffs, listScheduledOneOffs } from "@/lib/queries/one-offs";
import { loadReport } from "@/lib/queries/report";
import { actAs } from "@/lib/session";
import { todayInZone } from "@/lib/zone";

import mcp from "../../../messages/es/mcp.json";

const goalId = z.uuid();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month is YYYY-MM");

type Outcome = { value: Record<string, unknown> } | { error: string };

function answer(outcome: Outcome): CallToolResult {
  if ("error" in outcome) {
    return { content: [{ type: "text", text: JSON.stringify(errorOf(outcome.error)) }], isError: true };
  }
  return { content: [{ type: "text", text: JSON.stringify(outcome.value) }], structuredContent: outcome.value };
}

// `resolveBearer` is the only thing that builds the person `withMcpAuth`
// carries in `extra`, so a shape that is not one means the door was skipped.
function personOf(ctx: ServerContext): ResolvedPerson | null {
  const person = ctx.http?.authInfo?.extra?.person as Partial<ResolvedPerson> | undefined;
  return typeof person?.id === "string" && typeof person.email === "string" ? (person as ResolvedPerson) : null;
}

async function run(ctx: ServerContext, load: () => Promise<Outcome>): Promise<CallToolResult> {
  const person = personOf(ctx);
  if (person === null) return answer({ error: "mcp.errors.unauthorized" });
  try {
    return answer(await actAs(person, load));
  } catch (error) {
    // The cause stays in the server's log; the caller reads only the sentence.
    console.error("mcp read tool failed:", error instanceof Error ? error.message : String(error));
    return answer({ error: "mcp.errors.unknown" });
  }
}

export function registerReadTools(server: McpServer): void {
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;

  server.registerTool(
    "list_goals",
    { description: mcp.tools.list_goals, inputSchema: z.object({}), annotations: readOnly },
    (_input, ctx) => run(ctx, async () => ({ value: shapeGoalList(await listGoalsForMetas()) })),
  );

  server.registerTool(
    "get_goal",
    {
      description: mcp.tools.get_goal,
      inputSchema: z.object({ goal_id: goalId }),
      annotations: readOnly,
    },
    ({ goal_id }, ctx) =>
      run(ctx, async () => {
        const view = await loadGoal(goal_id);
        return view === null ? { error: "mcp.errors.goalNotFound" } : { value: shapeGoal(view) };
      }),
  );

  server.registerTool(
    "get_month",
    {
      description: mcp.tools.get_month,
      inputSchema: z.object({ goal_id: goalId, month }),
      annotations: readOnly,
    },
    (input, ctx) =>
      run(ctx, async () => {
        const view = await loadGoal(input.goal_id);
        if (view === null) return { error: "mcp.errors.goalNotFound" };
        const first = `${input.month}-01`;
        const items = planMonthList(view.plan, first);
        return { value: shapeMonth({ goalId: view.id, month: first, unit: view.measureUnit, items }) };
      }),
  );

  server.registerTool(
    "get_today",
    { description: mcp.tools.get_today, inputSchema: z.object({}), annotations: readOnly },
    (_input, ctx) => run(ctx, async () => ({ value: shapeDay(await loadDay(todayInZone())) })),
  );

  server.registerTool(
    "get_report",
    { description: mcp.tools.get_report, inputSchema: z.object({}), annotations: readOnly },
    (_input, ctx) => run(ctx, async () => ({ value: shapeReport(await loadReport(todayInZone())) })),
  );

  server.registerTool(
    "list_loose_one_offs",
    { description: mcp.tools.list_loose_one_offs, inputSchema: z.object({}), annotations: readOnly },
    (_input, ctx) =>
      run(ctx, async () => {
        const [dayless, scheduled] = await Promise.all([
          listDaylessOneOffs(),
          listScheduledOneOffs(todayInZone()),
        ]);
        return { value: shapeLoose({ dayless, scheduled }) };
      }),
  );
}
