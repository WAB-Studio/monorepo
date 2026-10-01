import { NextResponse, type NextRequest } from "next/server";

import { MODEL_NAME, modelAvailable, readPlan, type PlanInput } from "@/lib/import/model";
import { claimModelCall, settleModelCall, type ModelCallOutcome } from "@/lib/import/spend";
import { parseTemplate } from "@/lib/import/template";
import { getPerson } from "@/lib/session";

// Unmeasured: `readPlan` aborts at 120 s and no real call has been made, so
// this is that bound plus a margin. It is Vercel's Hobby ceiling with fluid
// compute (300 s) that allows it; a plan without it stops the function at 60 s.
export const maxDuration = 150;

const MAX_BODY_BYTES = 4 * 1024 * 1024;

const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".json"];

function reply(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function fail(status: number, error: string): NextResponse {
  return reply(status, { error });
}

function isTextFile(file: File): boolean {
  const mime = file.type.toLowerCase().split(";")[0].trim();
  const name = file.name.toLowerCase();
  return mime.startsWith("text/") || mime === "application/json" || TEXT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Reads a pasted plan or one file (RP-37, RNP-13) in a fixed order: the
 * template first, which needs neither key nor claim; then the key, named when
 * absent; then the claim; then the model. Every branch answers a body, never a
 * 204: an absent key is a 503 a person can read.
 */
export async function POST(request: NextRequest) {
  const person = await getPerson();
  if (!person) return fail(401, "import.errors.signedOut");

  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES) return fail(413, "import.errors.tooBig");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(422, "import.errors.empty");
  }

  const pasted = form.get("text");
  const upload = form.get("file");
  const file = upload instanceof File && upload.size > 0 ? upload : null;
  if (file && file.size > MAX_BODY_BYTES) return fail(413, "import.errors.tooBig");

  let input: PlanInput;
  let text: string | null = null;
  if (file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    input = { kind: "file", name: file.name, type: file.type, bytes };
    if (isTextFile(file)) text = new TextDecoder().decode(bytes);
  } else if (typeof pasted === "string" && pasted.trim() !== "") {
    input = { kind: "text", text: pasted };
    text = pasted;
  } else {
    return fail(422, "import.errors.empty");
  }

  if (text !== null) {
    const template = parseTemplate(text);
    if (template.matched) {
      if ("error" in template) {
        return reply(422, {
          error: "import.errors.templateLine",
          line: template.error.line,
          expected: template.error.expected,
        });
      }
      return reply(200, { via: "template", draft: template.draft });
    }
  }

  if (!modelAvailable()) return fail(503, "import.errors.noKey");

  const claim = await claimModelCall(MODEL_NAME, file ? "file" : "paste");
  if (!claim) return fail(429, "import.errors.cap");

  const reading = await readPlan(input).catch(() => ({ status: "failed" as const, usage: undefined }));

  // A type the model never saw has no outcome of its own: it settles as failed.
  const outcome: ModelCallOutcome = reading.status === "unreadableType" ? "failed" : reading.status;
  const usage = reading.usage;
  await settleModelCall(claim.id, {
    inputTokens: usage && "input" in usage ? usage.input : 0,
    outputTokens: usage && "output" in usage ? usage.output : 0,
    outcome,
  });

  switch (reading.status) {
    case "ok":
      return reply(200, { via: "model", draft: reading.draft });
    case "empty":
      return fail(422, "import.errors.empty");
    case "invalid":
      return fail(502, "import.errors.modelInvalid");
    case "unreadableType":
      return fail(415, "import.errors.unreadableType");
    case "failed":
      return fail(502, "import.errors.modelFailed");
  }
}
