export const ID_PREFIXES = [
  "cmd",
  "tx",
  "prj",
  "rel",
  "rep",
  "led",
  "resv",
  "req",
  "role"
] as const;

export type IdPrefix = (typeof ID_PREFIXES)[number];
export type OpaqueId = `${IdPrefix}_${string}`;

export function createOpaqueId(prefix: IdPrefix): OpaqueId {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function isOpaqueId(value: unknown, prefix?: IdPrefix): value is OpaqueId {
  if (typeof value !== "string") return false;

  const pattern = prefix === undefined
    ? /^(cmd|tx|prj|rel|rep|led|resv|req|role)_[0-9a-f-]{36}$/
    : new RegExp(`^${prefix}_[0-9a-f-]{36}$`);

  return pattern.test(value);
}
