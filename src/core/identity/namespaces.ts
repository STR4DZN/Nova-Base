export type Namespace = `${string}:${string}`;

export function normalizeNamespace(value: string): Namespace {
  const normalized = value.trim().toLowerCase();
  if (!isNamespace(normalized)) {
    throw new Error("Namespace must use the <owner>:<id> format");
  }

  return normalized as Namespace;
}

export function isNamespace(value: unknown): value is Namespace {
  return typeof value === "string" && /^[a-z0-9-]+:[a-z0-9-]+$/.test(value);
}
