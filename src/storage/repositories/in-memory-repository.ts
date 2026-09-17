import type { Repository } from "./contracts/repository.js";

export class InMemoryRepository<T, TId extends string = string>
  implements Repository<T, TId>
{
  private readonly entries: ReadonlyMap<TId, T>;

  constructor(items: readonly T[], getId: (item: T) => TId) {
    this.entries = new Map(items.map((item) => [getId(item), item]));
  }

  async get(id: TId): Promise<T | undefined> {
    return this.entries.get(id);
  }

  async has(id: TId): Promise<boolean> {
    return this.entries.has(id);
  }

  async list(): Promise<readonly T[]> {
    return [...this.entries.values()];
  }
}
