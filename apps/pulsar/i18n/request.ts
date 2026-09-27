import { getRequestConfig } from "next-intl/server";

// One locale and no routing: the interface is Spanish (RNP-01), no segment
// carries it and nothing negotiates it.
export default getRequestConfig(async () => {
  const [common, account, day, goal, plan, week, sources] = await Promise.all([
    import("../messages/es/common.json"),
    import("../messages/es/account.json"),
    import("../messages/es/day.json"),
    import("../messages/es/goal.json"),
    import("../messages/es/plan.json"),
    import("../messages/es/week.json"),
    import("../messages/es/sources.json"),
  ]);

  return {
    locale: "es",
    messages: {
      common: common.default,
      account: account.default,
      day: day.default,
      goal: goal.default,
      plan: plan.default,
      week: week.default,
      sources: sources.default,
    },
  };
});
