import type { DatabaseSync } from "node:sqlite";

export function readRevision(db: DatabaseSync, key: string) {
  const row = db
    .prepare("SELECT value_json value FROM app_settings WHERE key=?")
    .get(key) as { value: string } | undefined;
  if (!row) return null;
  const value = Number(JSON.parse(row.value));
  return Number.isFinite(value) ? value : null;
}

export function writeRevision(db: DatabaseSync, key: string, value: number) {
  db.prepare(
    "INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

export function bumpMetadataRevision(db: DatabaseSync) {
  const next = (readRevision(db, "metadata.revision") ?? 0) + 1;
  writeRevision(db, "metadata.revision", next);
  return next;
}
