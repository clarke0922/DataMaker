import fs from "node:fs";
import path from "node:path";

export type LogLevel = "info" | "warn" | "error";

function sanitizeText(value: string) {
  return value
    .replace(/[A-Za-z]:\\[^\r\n"']+/g, "[LOCAL_PATH]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .slice(0, 4_000);
}

function sanitize(value: unknown): unknown {
  if (value instanceof Error)
    return {
      name: value.name,
      message: sanitizeText(value.message),
      stack: value.stack ? sanitizeText(value.stack) : undefined,
    };
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        /password|token|secret|authorization/i.test(key) ? key : key,
        /password|token|secret|authorization/i.test(key)
          ? "[REDACTED]"
          : sanitize(item),
      ]),
    );
  return typeof value === "string" ? sanitizeText(value) : value;
}

export function createFileLogger(directory: string) {
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, "datamaker.log");
  const now = new Date();
  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    if (
      stat.size >= 5 * 1024 * 1024 ||
      stat.mtime.toDateString() !== now.toDateString()
    )
      fs.renameSync(
        filePath,
        path.join(
          directory,
          `datamaker-${stat.mtime.toISOString().replaceAll(":", "-")}.log`,
        ),
      );
  }
  for (const name of fs.readdirSync(directory)) {
    if (!/^datamaker-.+\.log$/.test(name)) continue;
    const archived = path.join(directory, name);
    if (
      fs.statSync(archived).mtimeMs <
      now.getTime() - 14 * 24 * 60 * 60 * 1000
    )
      fs.unlinkSync(archived);
  }
  const write = (level: LogLevel, message: string, context?: unknown) => {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context === undefined ? {} : { context: sanitize(context) }),
    };
    try {
      fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      /* Logging must never crash the application. */
    }
  };
  return {
    filePath,
    info: (message: string, context?: unknown) =>
      write("info", message, context),
    warn: (message: string, context?: unknown) =>
      write("warn", message, context),
    error: (message: string, context?: unknown) =>
      write("error", message, context),
  };
}
