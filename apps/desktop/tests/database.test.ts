import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MetadataDatabase } from "../src/main/database.js";

describe("MetadataDatabase", () => {
  it("creates the initial schema and seeds quality rules", () => {
    const database = new MetadataDatabase(":memory:");
    expect(database.stats()).toEqual({
      sources: 0,
      tables: 0,
      columns: 0,
      relations: 0,
      qualityIssues: 0,
    });
    expect(database.initialized()).toBe(false);
    const rules = (
      database.db
        .prepare("SELECT count(*) AS count FROM quality_rules")
        .get() as { count: number }
    ).count;
    expect(rules).toBe(7);
    database.close();
  });

  it("upgrades a version-three database through validated v4-v8 migrations", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "datamaker-v4-"));
    const file = path.join(directory, "meta.db");
    const original = new MetadataDatabase(file);
    original.db.exec(`
      DROP INDEX idx_audit_logs_result_occurred;
      DROP INDEX idx_meta_columns_table_ordinal;
      DROP INDEX idx_users_locked_until;
      DROP INDEX idx_data_sources_status;
      DROP INDEX idx_rule_results_status_created;
      DROP INDEX idx_rule_results_run_created;
      DROP TABLE export_jobs;
      ALTER TABLE users DROP COLUMN locked_until;
      ALTER TABLE users DROP COLUMN failed_login_count;
      ALTER TABLE data_sources DROP COLUMN last_error;
      ALTER TABLE rule_results DROP COLUMN resolved_by;
      ALTER TABLE rule_results DROP COLUMN resolved_at;
      ALTER TABLE rule_results DROP COLUMN resolution_note;
      ALTER TABLE rule_results DROP COLUMN status;
      ALTER TABLE rule_results DROP COLUMN run_id;
      DELETE FROM schema_migrations WHERE version IN (4,5,6,7,8);
      DELETE FROM app_settings WHERE key='metadata.revision';
    `);
    original.close();
    const upgraded = new MetadataDatabase(file);
    expect(
      (
        upgraded.db
          .prepare("SELECT MAX(version) version FROM schema_migrations")
          .get() as { version: number }
      ).version,
    ).toBe(8);
    expect(
      upgraded.db
        .prepare(
          "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='export_jobs'",
        )
        .get(),
    ).toBeTruthy();
    expect(
      (
        upgraded.db.prepare("PRAGMA table_info('users')").all() as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    ).toEqual(expect.arrayContaining(["failed_login_count", "locked_until"]));
    expect(
      (
        upgraded.db
          .prepare("PRAGMA table_info('data_sources')")
          .all() as Array<{ name: string }>
      ).map((column) => column.name),
    ).toContain("last_error");
    expect(
      (
        upgraded.db
          .prepare("PRAGMA table_info('rule_results')")
          .all() as Array<{ name: string }>
      ).map((column) => column.name),
    ).toEqual(
      expect.arrayContaining([
        "status",
        "resolution_note",
        "resolved_at",
        "resolved_by",
        "run_id",
      ]),
    );
    expect(
      upgraded.db
        .prepare(
          "SELECT 1 FROM sqlite_schema WHERE type='index' AND name='idx_audit_logs_result_occurred'",
        )
        .get(),
    ).toBeTruthy();
    expect(
      upgraded.db
        .prepare(
          "SELECT value_json FROM app_settings WHERE key='metadata.revision'",
        )
        .get(),
    ).toEqual({ value_json: "0" });
    upgraded.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("refuses to start when an applied migration checksum was modified", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "datamaker-checksum-"),
    );
    const file = path.join(directory, "meta.db");
    const database = new MetadataDatabase(file);
    database.db
      .prepare(
        "UPDATE schema_migrations SET checksum='tampered' WHERE version=8",
      )
      .run();
    database.close();
    expect(() => new MetadataDatabase(file)).toThrow("checksum mismatch");
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("refuses to migrate a corrupted metadata database", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "datamaker-corrupt-"),
    );
    const file = path.join(directory, "meta.db");
    const database = new MetadataDatabase(file);
    database.close();
    fs.writeFileSync(file, Buffer.from("not-a-sqlite-database"));
    expect(() => new MetadataDatabase(file)).toThrow();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("enforces foreign keys", () => {
    const database = new MetadataDatabase(":memory:");
    expect(() =>
      database.db
        .prepare(
          "INSERT INTO user_roles(user_id, role_id) VALUES('missing-user','missing-role')",
        )
        .run(),
    ).toThrow();
    database.close();
  });

  it("searches Chinese text and treats FTS operators as plain user input", () => {
    const database = new MetadataDatabase(":memory:");
    database.db
      .prepare(
        "INSERT INTO metadata_fts(object_id,object_type,name,path,comment) VALUES(?,?,?,?,?)",
      )
      .run("1", "table", "用户-信息", "main/用户-信息", "用户资料");
    expect(database.search("用户")).toHaveLength(1);
    expect(() => database.search('用户 OR "信息"')).not.toThrow();
    expect(() => database.search("*")).not.toThrow();
    database.close();
  });

  it("rebuilds table and column search documents after a restore", () => {
    const database = new MetadataDatabase(":memory:");
    const now = new Date().toISOString();
    database.db
      .prepare(
        "INSERT INTO data_sources(id,name,type,created_at,updated_at) VALUES(?,?,?,?,?)",
      )
      .run("source", "Local", "sqlite", now, now);
    database.db
      .prepare("INSERT INTO catalogs(id,data_source_id,name) VALUES(?,?,?)")
      .run("catalog", "source", "main");
    database.db
      .prepare("INSERT INTO schemas(id,catalog_id,name) VALUES(?,?,?)")
      .run("schema", "catalog", "main");
    database.db
      .prepare(
        "INSERT INTO meta_tables(id,schema_id,name,fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .run("table", "schema", "customers", "hash", now, now);
    database.db
      .prepare(
        "INSERT INTO meta_columns(id,table_id,name,ordinal,raw_type,normalized_type,nullable) VALUES(?,?,?,?,?,?,?)",
      )
      .run("column", "table", "customer_code", 1, "TEXT", "text", 0);
    database.db
      .prepare("INSERT INTO tags(id,name) VALUES(?,?)")
      .run("tag", "important");
    database.db
      .prepare(
        "INSERT INTO object_tags(object_type,object_id,tag_id) VALUES(?,?,?)",
      )
      .run("column", "column", "tag");
    database.rebuildSearchIndex();
    expect(database.search("customers")[0]?.path).toBe("Local/main/customers");
    expect(database.search("important")[0]?.id).toBe("column");
    database.close();
  });

  it("keeps full-text search bounded at one hundred thousand metadata fields", () => {
    const database = new MetadataDatabase(":memory:");
    database.db.exec(
      "WITH RECURSIVE sequence(value) AS (VALUES(1) UNION ALL SELECT value+1 FROM sequence WHERE value<100000) INSERT INTO metadata_fts(object_id,object_type,name,path,comment) SELECT printf('field-%d',value),'column',printf('customer_field_%d',value),printf('main/customer/field_%d',value),'customer metadata' FROM sequence",
    );
    const started = performance.now();
    const results = database.search("customer");
    expect(results).toHaveLength(50);
    expect(performance.now() - started).toBeLessThan(5000);
    database.close();
  });
});
