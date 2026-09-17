const SENSITIVE_KEY = /(secret|token|password|api[-_]?key|credential|authorization)/i;

export function sanitizeDiagnosticsValue(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  if (typeof value === "function") {
    return `[Function: ${value.name || "anonymous"}]`;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return "[Circular]";
    ancestors.add(value);
    const result = value.map((item) => sanitizeDiagnosticsValue(item, ancestors));
    ancestors.delete(value);
    return result;
  }
  if (typeof value !== "object" || value === null) return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {})
    };
  }
  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_KEY.test(key)
      ? "[REDACTED]"
      : sanitizeDiagnosticsValue(child, ancestors);
  }
  ancestors.delete(value);
  return sanitized;
}
