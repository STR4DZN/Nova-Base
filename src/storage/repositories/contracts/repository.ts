export interface Repository<T, TId extends string = string> {
  get(id: TId): Promise<T | undefined>;
  has(id: TId): Promise<boolean>;
  list(): Promise<readonly T[]>;
}
