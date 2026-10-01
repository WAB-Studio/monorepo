import { importDraftSchema, type ImportDraft } from "./draft";

const KEY = "pulsar.import-draft";

export type StoredDraft = { via: "template" | "model"; draft: ImportDraft };

// The draft rides from the import screen to its review in the tab's own
// storage: a reload of the review keeps it, a new tab starts without it, and
// nothing reaches the database before the confirm.
export function saveDraft(stored: StoredDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable: the review finds no draft and sends the person back.
  }
}

// `null` for nothing stored, anything unreadable, or a draft the schema refuses.
export function readDraft(): StoredDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { via?: unknown; draft?: unknown };
    if (parsed.via !== "template" && parsed.via !== "model") return null;
    const draft = importDraftSchema.safeParse(parsed.draft);
    return draft.success ? { via: parsed.via, draft: draft.data } : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
