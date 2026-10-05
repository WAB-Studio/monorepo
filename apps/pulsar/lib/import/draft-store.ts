import { importDraftSchema, type ImportDraft } from "./draft";

const KEY = "pulsar.import-draft";

// `source` is the pasted text, `null` for a file. `unmarked` is `null` until
// the review first saves, so a fresh draft differs from one the person marked.
export type StoredDraft = {
  via: "template" | "model";
  draft: ImportDraft;
  source: string | null;
  unmarked: string[] | null;
};

// The draft rides from the import screen to its review in the tab's own
// storage: a reload of the review keeps it, a new tab starts without it, and
// nothing reaches the database before the confirm.
export function saveDraft(input: { via: StoredDraft["via"]; draft: ImportDraft; source?: string | null }): void {
  write({ via: input.via, draft: input.draft, source: input.source ?? null, unmarked: null });
}

// Rewrites the draft and the unmarked paths; `via` and `source` stay.
export function saveReview(draft: ImportDraft, unmarked: string[]): void {
  const current = readDraft();
  if (!current) return;
  write({ ...current, draft, unmarked });
}

// `null` for nothing stored, anything unreadable, or a draft the schema refuses.
export function readDraft(): StoredDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { via?: unknown; draft?: unknown; source?: unknown; unmarked?: unknown };
    if (parsed.via !== "template" && parsed.via !== "model") return null;
    const draft = importDraftSchema.safeParse(parsed.draft);
    if (!draft.success) return null;
    return {
      via: parsed.via,
      draft: draft.data,
      source: typeof parsed.source === "string" ? parsed.source : null,
      unmarked: Array.isArray(parsed.unmarked)
        ? parsed.unmarked.filter((p): p is string => typeof p === "string")
        : null,
    };
  } catch {
    return null;
  }
}

export function readSource(): string | null {
  return readDraft()?.source ?? null;
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

function write(stored: StoredDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable: the review finds no draft and sends the person back.
  }
}
