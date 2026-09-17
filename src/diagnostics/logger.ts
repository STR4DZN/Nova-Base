export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  readonly correlationId?: string;
  readonly [key: string]: unknown;
}

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly context?: LogContext;
}

export class Logger {
  constructor(readonly scope: string) {}

  debug(message: string, context?: LogContext): LogEntry {
    return this.write("debug", message, context);
  }

  info(message: string, context?: LogContext): LogEntry {
    return this.write("info", message, context);
  }

  warn(message: string, context?: LogContext): LogEntry {
    return this.write("warn", message, context);
  }

  error(message: string, context?: LogContext): LogEntry {
    return this.write("error", message, context);
  }

  private write(level: LogLevel, message: string, context?: LogContext): LogEntry {
    const safeContext = context === undefined
      ? undefined
      : sanitizeDiagnosticsValue(context) as LogContext;
    const entry = safeContext === undefined ? { level, message } : { level, message, context: safeContext };
    const output = `[${this.scope}] ${message}`;

    if (level === "error") console.error(output, safeContext ?? "");
    else if (level === "warn") console.warn(output, safeContext ?? "");
    else console.info(output, safeContext ?? "");

    return entry;
  }
}
import { sanitizeDiagnosticsValue } from "./sanitize.js";
