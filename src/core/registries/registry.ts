export class RegistryCollisionError extends Error {
  readonly code = "DM_REGISTRY_COLLISION";

  constructor(readonly registryId: string, readonly entryId: string) {
    super(`Registry '${registryId}' already contains '${entryId}'`);
    this.name = "RegistryCollisionError";
  }
}

export class RegistryFrozenError extends Error {
  readonly code = "DM_REGISTRY_FROZEN";

  constructor(readonly registryId: string) {
    super(`Registry '${registryId}' is frozen`);
    this.name = "RegistryFrozenError";
  }
}

export class Registry<T> {
  private readonly entries = new Map<string, T>();
  private frozen = false;

  constructor(readonly registryId: string) {}

  register(entryId: string, entry: T): void {
    if (this.frozen) throw new RegistryFrozenError(this.registryId);
    if (this.entries.has(entryId)) {
      throw new RegistryCollisionError(this.registryId, entryId);
    }
    this.entries.set(entryId, entry);
  }

  get(entryId: string): T | undefined {
    return this.entries.get(entryId);
  }

  has(entryId: string): boolean {
    return this.entries.has(entryId);
  }

  freeze(): void {
    this.frozen = true;
  }

  isFrozen(): boolean {
    return this.frozen;
  }
}
