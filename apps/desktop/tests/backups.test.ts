import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MetadataDatabase } from "../src/main/database.js";
import {
  createAutomaticBackup,
  createPreMigrationBackup,
  validateRestoreCandidate,
} from "../src/main/backups.js";
describe("automatic backups", () => {
  it("backs up an older database before migrations", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "datamaker-migration-"),
    );
    const databasePath = path.join(directory, "legacy.db");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(
      "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES(2); CREATE TABLE legacy_data(value TEXT); INSERT INTO legacy_data VALUES('preserved')",
    );
    legacy.close();
    const destination = await createPreMigrationBackup(
      databasePath,
      path.join(directory, "backups"),
      3,
      new Date("2026-08-14T01:02:03Z"),
    );
    expect(destination && fs.existsSync(destination)).toBe(true);
    const copy = new DatabaseSync(destination!, { readOnly: true });
    expect(copy.prepare("SELECT value FROM legacy_data").get()).toEqual({
      value: "preserved",
    });
    copy.close();
    expect(
      await createPreMigrationBackup(
        databasePath,
        path.join(directory, "backups"),
        2,
      ),
    ).toBeNull();
    for (let day = 1; day <= 6; day++)
      await createPreMigrationBackup(
        databasePath,
        path.join(directory, "backups"),
        3,
        new Date(`2026-08-${String(day).padStart(2, "0")}T01:00:00Z`),
      );
    expect(
      fs
        .readdirSync(path.join(directory, "backups"))
        .filter((name) => name.startsWith("datamaker-pre-migration-")),
    ).toHaveLength(5);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("creates one backup per day and keeps the newest five", async () => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "datamaker-backup-"),
      ),
      databasePath = path.join(directory, "datamaker.db"),
      backupDirectory = path.join(directory, "backups");
    const database = new MetadataDatabase(databasePath);
    const first = await createAutomaticBackup(
      database.db,
      databasePath,
      backupDirectory,
      new Date("2026-08-14T01:00:00Z"),
    );
    expect(first && fs.existsSync(first)).toBe(true);
    const candidate = new DatabaseSync(first!, { readOnly: true });
    expect(candidate.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    candidate.close();
    expect(
      await createAutomaticBackup(
        database.db,
        databasePath,
        backupDirectory,
        new Date("2026-08-14T23:00:00Z"),
      ),
    ).toBeNull();
    for (let day = 1; day <= 8; day++) {
      database.db
        .prepare(
          "UPDATE app_settings SET value_json='\"reset\"' WHERE key='backup.lastDate'",
        )
        .run();
      await createAutomaticBackup(
        database.db,
        databasePath,
        backupDirectory,
        new Date(`2026-08-${String(day).padStart(2, "0")}T01:00:00Z`),
      );
    }
    expect(
      fs.readdirSync(backupDirectory).filter((name) => name.endsWith(".db")),
    ).toHaveLength(5);
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("rejects restore candidates created by a newer schema", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "datamaker-restore-"),
    );
    const file = path.join(directory, "future.db");
    const future = new DatabaseSync(file);
    future.exec(
      "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES(999)",
    );
    future.close();
    expect(() => validateRestoreCandidate(file)).toThrow(
      "newer than supported version",
    );
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
