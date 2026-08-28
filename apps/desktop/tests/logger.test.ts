import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFileLogger } from "../src/main/logger.js";

describe("file logger", () => {
  it("writes structured entries and redacts sensitive context", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "datamaker-log-"));
    const logger = createFileLogger(directory);
    logger.info("started", {
      port: 1234,
      token: "private",
      nested: { password: "secret" },
    });
    logger.error(
      "failed",
      new Error("boom at C:\\Users\\Administrator\\secret\\source.db"),
    );
    const lines = fs
      .readFileSync(logger.filePath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines[0]).toMatchObject({
      level: "info",
      message: "started",
      context: {
        port: 1234,
        token: "[REDACTED]",
        nested: { password: "[REDACTED]" },
      },
    });
    expect(lines[1].context).toMatchObject({
      name: "Error",
      message: "boom at [LOCAL_PATH]",
    });
    expect(JSON.stringify(lines[1])).not.toContain("Administrator");
    fs.rmSync(directory, { recursive: true, force: true });
  });
  it("rotates previous-day logs and removes archives older than fourteen days", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "datamaker-log-"));
    const active = path.join(directory, "datamaker.log");
    const expired = path.join(directory, "datamaker-expired.log");
    fs.writeFileSync(active, "previous\n");
    fs.writeFileSync(expired, "expired\n");
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const old = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    fs.utimesSync(active, yesterday, yesterday);
    fs.utimesSync(expired, old, old);

    const logger = createFileLogger(directory);
    logger.info("today");

    expect(fs.readFileSync(logger.filePath, "utf8")).toContain("today");
    expect(
      fs
        .readdirSync(directory)
        .some((name) => /^datamaker-20.+\.log$/.test(name)),
    ).toBe(true);
    expect(fs.existsSync(expired)).toBe(false);
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
