import fs from "node:fs";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { CURRENT_SCHEMA_VERSION } from "./database.js";

export function validateRestoreCandidate(filePath: string) {
  const candidate = new DatabaseSync(filePath, { readOnly: true });
  try {
    const integrity = (
      candidate.prepare("PRAGMA integrity_check").get() as {
        integrity_check: string;
      }
    ).integrity_check;
    if (integrity !== "ok")
      throw new Error(`Backup integrity check failed: ${integrity}`);
    if (
      !candidate
        .prepare(
          "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='schema_migrations'",
        )
        .get()
    )
      throw new Error("The selected file is not a DataMaker backup");
    const version = Number(
      (
        candidate
          .prepare("SELECT MAX(version) version FROM schema_migrations")
          .get() as { version: number | null }
      ).version ?? 0,
    );
    if (version > CURRENT_SCHEMA_VERSION)
      throw new Error(
        `Backup schema version ${version} is newer than supported version ${CURRENT_SCHEMA_VERSION}`,
      );
    return { version };
  } finally {
    candidate.close();
  }
}

export async function createPreMigrationBackup(
  databasePath: string,
  backupDirectory: string,
  targetVersion = CURRENT_SCHEMA_VERSION,
  now = new Date(),
  retain = 5,
) {
  if (databasePath === ":memory:" || !fs.existsSync(databasePath)) return null;
  const source = new DatabaseSync(databasePath, {
    readOnly: true,
  });
  try {
    let version = 0;
    try {
      version = Number(
        (
          source
            .prepare("SELECT MAX(version) version FROM schema_migrations")
            .get() as { version: number | null }
        ).version ?? 0,
      );
    } catch {
      // A database created before versioned migrations is version zero.
    }
    if (version >= targetVersion) return null;
    fs.mkdirSync(backupDirectory, { recursive: true });
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const destination = path.join(
      backupDirectory,
      `datamaker-pre-migration-v${version}-${stamp}.db`,
    );
    await backup(source, destination);
    const backups = fs
      .readdirSync(backupDirectory)
      .filter((name) => /^datamaker-pre-migration-v\d+-.+\.db$/.test(name))
      .sort()
      .reverse();
    for (const expired of backups.slice(Math.max(1, retain)))
      fs.unlinkSync(path.join(backupDirectory, expired));
    return destination;
  } finally {
    source.close();
  }
}

export async function createAutomaticBackup(
  db: DatabaseSync,
  databasePath: string,
  backupDirectory: string,
  now = new Date(),
  retain = 5,
) {
  if (databasePath === ":memory:" || !fs.existsSync(databasePath)) return null;
  const date = now.toISOString().slice(0, 10);
  const setting = db
    .prepare(
      "SELECT value_json value FROM app_settings WHERE key='backup.lastDate'",
    )
    .get() as { value: string } | undefined;
  if (setting && JSON.parse(setting.value) === date) return null;
  fs.mkdirSync(backupDirectory, { recursive: true });
  const destination = path.join(backupDirectory, `datamaker-auto-${date}.db`);
  await backup(db, destination);
  db.prepare(
    "INSERT INTO app_settings(key,value_json,updated_at) VALUES('backup.lastDate',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
  ).run(JSON.stringify(date), now.toISOString());
  const backups = fs
    .readdirSync(backupDirectory)
    .filter((name) => /^datamaker-auto-\d{4}-\d{2}-\d{2}\.db$/.test(name))
    .sort()
    .reverse();
  for (const expired of backups.slice(Math.max(1, retain)))
    fs.unlinkSync(path.join(backupDirectory, expired));
  return destination;
}
