import { createTranslator } from "next-intl";

import connections from "../../messages/es/connections.json";
import day from "../../messages/es/day.json";
import goal from "../../messages/es/goal.json";
import importMessages from "../../messages/es/import.json";
import mcp from "../../messages/es/mcp.json";
import month from "../../messages/es/month.json";
import oauth from "../../messages/es/oauth.json";
import plan from "../../messages/es/plan.json";
import roadmap from "../../messages/es/roadmap.json";

// The request config belongs to a request; a tool answers outside one, so the
// catalogue is read here directly, in the one locale there is.
const messages = { connections, day, goal, import: importMessages, mcp, month, oauth, plan, roadmap };
const translate = createTranslator({ locale: "es", messages });

const KEY = /^[A-Za-z]+\.errors\.[A-Za-z]+$/;

function hasSentence(key: string): boolean {
  if (!KEY.test(key)) return false;
  const [namespace, ...path] = key.split(".");
  let node: unknown = (messages as Record<string, unknown>)[namespace];
  for (const part of path) {
    if (typeof node !== "object" || node === null) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string";
}

// What an act's error key says, in Spanish. The key survives beside it so a
// caller can branch on it; an unknown one is `mcp.errors.unknown`, never an
// echo of its input.
export function errorOf(key: string): { key: string; message: string } {
  if (!hasSentence(key)) return { key: "mcp.errors.unknown", message: translate("mcp.errors.unknown") };
  return { key, message: translate(key as Parameters<typeof translate>[0]) };
}
