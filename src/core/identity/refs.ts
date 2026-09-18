export interface DocumentRef {
  readonly uuid: string;
  readonly lastKnownName?: string;
  readonly lastKnownImg?: string;
}

export interface TypedRef {
  readonly type: string;
  readonly id?: string;
  readonly uuid?: string;
}

/**
 * Runtime validation for canonical Foundry document UUIDs.
 *
 * World documents use `<DocumentName>.<id>`. Compendium documents keep the
 * `Compendium.<package>.<pack>.<DocumentName>.<id>` shape. Embedded-document
 * UUIDs remain valid because they add further non-empty segment pairs.
 */
export function isFoundryUuid(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) return false;
  const segments = value.split(".");
  if (segments.some((segment) => segment.length === 0)) return false;
  if (segments[0] === "Compendium") return segments.length >= 6;
  return segments.length >= 2;
}

export function isJournalEntryUuid(value: unknown): value is string {
  if (!isFoundryUuid(value)) return false;
  const segments = value.split(".");
  if (segments[0] === "JournalEntry") return segments.length >= 2;
  if (segments[0] !== "Compendium") return false;
  return segments.includes("JournalEntry");
}

export function worldJournalEntryUuid(id: string): string {
  if (typeof id !== "string" || id.trim().length === 0 || id.includes(".")) {
    throw new Error("JournalEntry id must be a non-empty local document id");
  }
  return `JournalEntry.${id}`;
}

export function isActorUuid(value: unknown): value is string {
  if (!isFoundryUuid(value)) return false;
  const segments = (value as string).split(".");
  if (segments[0] === "Actor") return segments.length >= 2;
  if (segments[0] !== "Compendium") return false;
  return segments.includes("Actor");
}

export function worldActorUuid(id: string): string {
  if (typeof id !== "string" || id.trim().length === 0 || id.includes(".")) {
    throw new Error("Actor id must be a non-empty local document id");
  }
  return `Actor.${id}`;
}
