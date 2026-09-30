import { canonicalJsonStringify } from "../commands/command-dedupe-store.js";
import { isJsonData, isRecord, isText, isTimestamp, immutable } from "../core/validation/value-validation.js";
export const DIPLOMACY_FLAG = "domain-manager-diplomacy";
export const DIPLOMACY_KINDS = ["relation", "reputation", "agreement", "territory", "dispute", "proposal"] as const;
export type DiplomacyKind = typeof DIPLOMACY_KINDS[number];
export interface DiplomacyCommandReceipt {
  readonly commandId: string; readonly fingerprint: string; readonly revision: number; readonly changed: boolean;
  readonly requesterUserId?: string;
  readonly result?: unknown;
}
/** The adapter shares persistence mechanics, never the owners' business state. One entity per GM-only journal. */
export interface DiplomacyEntity {
  readonly schemaVersion: 1; readonly kind: DiplomacyKind; readonly id: string; readonly revision: number;
  readonly data: unknown; readonly receipts: readonly DiplomacyCommandReceipt[];
}
export const diplomacyKey = (kind: DiplomacyKind, id: string) => JSON.stringify([kind, id]);
export interface DiplomacyStorageAdapter {
  loadAll(): Promise<readonly DiplomacyEntity[]>;
  read(kind: DiplomacyKind, id: string): Promise<DiplomacyEntity | null>;
  write(entity: DiplomacyEntity): Promise<void>;
  remove(kind: DiplomacyKind, id: string): Promise<void>;
}
export function assertDiplomacyEntity(x: unknown): asserts x is DiplomacyEntity {
  if (!isRecord(x) || !isJsonData(x) || x.schemaVersion !== 1 || !DIPLOMACY_KINDS.includes(x.kind as DiplomacyKind)
    || !isText(x.id) || !isTimestamp(x.revision) || !Array.isArray(x.receipts)) throw new Error("DM_DIPLOMACY_STORAGE_CORRUPT");
  const ids = new Set<string>();
  for (const r of x.receipts) {
    if (!isRecord(r) || !isText(r.commandId) || ids.has(r.commandId) || !isText(r.fingerprint) || !isTimestamp(r.revision)
      || r.revision > x.revision || typeof r.changed !== "boolean"
      || (r.requesterUserId !== undefined && !isText(r.requesterUserId))) throw new Error("DM_DIPLOMACY_STORAGE_CORRUPT");
    ids.add(r.commandId);
  }
}
export class InMemoryDiplomacyStorageAdapter implements DiplomacyStorageAdapter {
  constructor(readonly state = new Map<string, DiplomacyEntity>()) {}
  async loadAll(): Promise<readonly DiplomacyEntity[]> { return structuredClone([...this.state.values()]); }
  async read(kind: DiplomacyKind, id: string): Promise<DiplomacyEntity | null> { return structuredClone(this.state.get(diplomacyKey(kind, id)) ?? null); }
  async write(entity: DiplomacyEntity): Promise<void> { assertDiplomacyEntity(entity); this.state.set(diplomacyKey(entity.kind, entity.id), structuredClone(entity)); }
  async remove(kind: DiplomacyKind, id: string): Promise<void> { this.state.delete(diplomacyKey(kind, id)); }
}
interface Journal { readonly id: string; readonly flags?: Readonly<Record<string, unknown>>; readonly ownership?: Readonly<Record<string, number>>;
  update(data: Readonly<Record<string, unknown>>): Promise<unknown>; delete(): Promise<unknown>; }
export interface DiplomacyJournalHost {
  readonly journal: { readonly contents: readonly Journal[]; get?(id: string): Journal | undefined };
  create(data: Readonly<Record<string, unknown>>, options?: Readonly<Record<string, unknown>>): Promise<Journal>;
}
export class FoundryDiplomacyStorageAdapter implements DiplomacyStorageAdapter {
  readonly #documents = new Map<string, Journal>();
  constructor(readonly host?: DiplomacyJournalHost) {}
  #host(): DiplomacyJournalHost | undefined {
    if (this.host) return this.host;
    const globals = globalThis as any;
    return globals.game?.journal && globals.JournalEntry?.create
      ? { journal: globals.game.journal, create: (d, o) => globals.JournalEntry.create(d, o) } : undefined;
  }
  #record(doc: Journal): DiplomacyEntity {
    const e = doc.flags?.[DIPLOMACY_FLAG]; assertDiplomacyEntity(e);
    if (Object.entries(doc.ownership ?? {}).some(([id, level]) => level > 0 && !(globalThis as any).game?.users?.get?.(id)?.isGM))
      throw new Error("DM_DIPLOMACY_STORAGE_NOT_PRIVATE");
    return e;
  }
  async loadAll(): Promise<readonly DiplomacyEntity[]> {
    this.#documents.clear(); const result: DiplomacyEntity[] = [];
    for (const doc of this.#host()?.journal.contents ?? []) {
      if (!doc.flags?.[DIPLOMACY_FLAG]) continue;
      const e = this.#record(doc), key = diplomacyKey(e.kind, e.id);
      if (this.#documents.has(key)) throw new Error("DM_DIPLOMACY_STORAGE_DUPLICATE");
      this.#documents.set(key, doc); result.push(structuredClone(e));
    }
    return result;
  }
  async read(kind: DiplomacyKind, id: string): Promise<DiplomacyEntity | null> {
    const key = diplomacyKey(kind, id); let doc = this.#documents.get(key);
    if (doc && this.#host()?.journal.get && this.#host()!.journal.get!(doc.id) !== doc) { this.#documents.delete(key); doc = undefined; }
    if (!doc) doc = this.#host()?.journal.contents.find(d => { const e = d.flags?.[DIPLOMACY_FLAG] as DiplomacyEntity | undefined; return e?.kind === kind && e.id === id; });
    if (!doc) return null;
    this.#documents.set(key, doc); return structuredClone(this.#record(doc));
  }
  async write(entity: DiplomacyEntity): Promise<void> {
    assertDiplomacyEntity(entity); const host = this.#host(); if (!host) throw new Error("DM_DIPLOMACY_STORAGE_UNAVAILABLE");
    const key = diplomacyKey(entity.kind, entity.id), current = await this.read(entity.kind, entity.id), doc = this.#documents.get(key);
    const data = { name: "[Domain Manager] Diplomacy", ownership: { default: 0 }, flags: { [DIPLOMACY_FLAG]: structuredClone(entity) } };
    if (current && doc) await doc.update({ [`flags.${DIPLOMACY_FLAG}`]: entity, ownership: { default: 0 } });
    else {
      const territoryId = entity.kind === "territory" && /^JournalEntry\.[a-zA-Z0-9]{16}$/.test(entity.id) ? entity.id.slice(13) : null;
      if (entity.kind === "territory" && territoryId === null) throw new Error("DM_TERRITORY_DOCUMENT_ID_INVALID");
      const created = await host.create({ ...data, ...(territoryId ? { _id: territoryId } : {}) }, { keepId: !!territoryId });
      this.#documents.set(key, created);
    }
  }
  async remove(kind: DiplomacyKind, id: string): Promise<void> {
    const current = await this.read(kind, id); if (!current) return;
    const key = diplomacyKey(kind, id), doc = this.#documents.get(key); if (doc) await doc.delete(); this.#documents.delete(key);
  }
}
export class DiplomacyEntityStore {
  readonly #entities = new Map<string, DiplomacyEntity>();
  readonly #byKind = new Map<DiplomacyKind, Set<string>>();
  readonly #children = new Map<string, Set<string>>();
  constructor(readonly adapter: DiplomacyStorageAdapter) {}
  async rehydrate(): Promise<void> {
    const rows = await this.adapter.loadAll(); this.#entities.clear(); this.#byKind.clear(); this.#children.clear();
    for (const e of rows) { assertDiplomacyEntity(e); const key = diplomacyKey(e.kind, e.id);
      if (this.#entities.has(key)) throw new Error("DM_DIPLOMACY_STORAGE_DUPLICATE"); this.#index(e); }
  }
  #index(entity: DiplomacyEntity): void {
    const key = diplomacyKey(entity.kind, entity.id), old = this.#entities.get(key);
    this.#indexParents(old, key, false); this.#indexParents(entity, key, true);
    this.#entities.set(key, immutable(structuredClone(entity)));
    const kind = this.#byKind.get(entity.kind) ?? new Set<string>(); kind.add(key); this.#byKind.set(entity.kind, kind);
  }
  #indexParents(entity: DiplomacyEntity | undefined, key: string, add: boolean): void {
    if (entity?.kind !== "territory" || !isRecord(entity.data) || !isRecord(entity.data.territory)) return;
    for (const axis of ["locatedInUuid", "administrativeParentUuid"] as const) {
      const parent = JSON.stringify([axis, entity.data.territory[axis]]), index = this.#children.get(parent) ?? new Set<string>();
      if (add) index.add(key); else index.delete(key);
      if (index.size) this.#children.set(parent, index); else this.#children.delete(parent);
    }
  }
  children(parentUuid: string | null, axis: "locatedInUuid" | "administrativeParentUuid"): readonly DiplomacyEntity[] {
    return [...this.#children.get(JSON.stringify([axis, parentUuid])) ?? []].map(key => this.#entities.get(key)!).filter(Boolean);
  }
  list(kind: DiplomacyKind): readonly DiplomacyEntity[] { return [...this.#byKind.get(kind) ?? []].map(k => this.#entities.get(k)!); }
  get(kind: DiplomacyKind, id: string): DiplomacyEntity | null { return this.#entities.get(diplomacyKey(kind, id)) ?? null; }
  async freshRead(kind: DiplomacyKind, id: string): Promise<DiplomacyEntity | null> {
    const e = await this.adapter.read(kind, id); if (e) { assertDiplomacyEntity(e); this.#index(e); }
    else { const key = diplomacyKey(kind, id); this.#indexParents(this.#entities.get(key), key, false); this.#entities.delete(key); this.#byKind.get(kind)?.delete(key); }
    return e;
  }
  async save(entity: DiplomacyEntity): Promise<void> { await this.adapter.write(entity); this.#index(entity); }
  async stage(entity: DiplomacyEntity): Promise<void> { await this.adapter.write(entity); }
  publish(entity: DiplomacyEntity): void { this.#index(entity); }
  async remove(kind: DiplomacyKind, id: string): Promise<void> {
    await this.adapter.remove(kind, id); const key = diplomacyKey(kind, id);
    this.#indexParents(this.#entities.get(key), key, false); this.#entities.delete(key); this.#byKind.get(kind)?.delete(key);
  }
}
export const diplomacyFingerprint = (type: string, payload: unknown) => canonicalJsonStringify({ type, payload });
