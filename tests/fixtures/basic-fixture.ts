export interface BasicFixture<T> {
  readonly id: string;
  readonly value: T;
}

export function createBasicFixture<T>(id: string, value: T): BasicFixture<T> {
  return Object.freeze({ id, value });
}
