import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MetadataDatabase } from "../src/main/database.js";
import { DataSourceRepository } from "../src/main/sources.js";

describe("DataSourceRepository", () => {
  it("rejects directories and corrupt SQLite files before saving", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "datamaker-source-"),
    );
    const corrupt = path.join(directory, "corrupt.db");
    fs.writeFileSync(corrupt, "this is not sqlite", "utf8");
    const database = new MetadataDatabase(":memory:");
    const sources = new DataSourceRepository(database.db);
    expect(() =>
      sources.save({
        name: "Directory",
        type: "sql_file",
        filePath: directory,
      }),
    ).toThrow("regular file");
    expect(() =>
      sources.save({ name: "Corrupt", type: "sqlite", filePath: corrupt }),
    ).toThrow("SQLite source is invalid");
    expect(sources.list()).toHaveLength(0);
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("protects a data source while its scan job is running", () => {
    const file = path.join(os.tmpdir(), `datamaker-running-${Date.now()}.sql`);
    fs.writeFileSync(file, "CREATE TABLE T (ID INTEGER);", "utf8");
    const database = new MetadataDatabase(":memory:");
    const sources = new DataSourceRepository(database.db);
    const source = sources.save({
      name: "Running",
      type: "sql_file",
      filePath: file,
    });
    database.db
      .prepare(
        "INSERT INTO scan_jobs(id,data_source_id,status,started_at) VALUES('job',?,'running','x')",
      )
      .run(source.id);
    expect(() => sources.remove(source.id)).toThrow("cannot be deleted");
    expect(() => sources.save({ ...source, name: "Changed" })).toThrow(
      "cannot be modified",
    );
    expect(sources.list()).toHaveLength(1);
    database.close();
    fs.unlinkSync(file);
  });

  it("scans SQLite tables, columns, foreign keys, updates, retirement, and search", () => {
    const file = path.join(os.tmpdir(), `datamaker-source-${Date.now()}.db`);
    const external = new DatabaseSync(file);
    external.exec(
      "CREATE TABLE parent(id INTEGER PRIMARY KEY, name TEXT); CREATE UNIQUE INDEX idx_parent_name ON parent(name); CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));",
    );
    external.close();
    const database = new MetadataDatabase(":memory:");
    const sources = new DataSourceRepository(database.db);
    const source = sources.save({
      name: "Demo Source",
      type: "sqlite",
      filePath: file,
    });
    expect(sources.preview(source.id)).toMatchObject({
      added: ["child", "parent"],
      updated: [],
      retired: [],
      unchanged: 0,
    });
    const first = sources.scan(source.id);
    expect(sources.preview(source.id).unchanged).toBe(2);
    expect(first).toMatchObject({
      tables: 2,
      columns: 4,
      relations: 1,
      added: 2,
    });
    expect(
      database.db
        .prepare(
          "SELECT name,unique_flag uniqueFlag,columns_json columnsJson FROM meta_indexes WHERE name='idx_parent_name'",
        )
        .get(),
    ).toEqual({
      name: "idx_parent_name",
      uniqueFlag: 1,
      columnsJson: '["name"]',
    });
    expect(database.search("parent").length).toBeGreaterThan(0);
    const originalColumn = database.db
      .prepare("SELECT id FROM meta_columns WHERE name='parent_id'")
      .get() as { id: string };
    database.db
      .prepare("UPDATE meta_columns SET comment='Owned note' WHERE id=?")
      .run(originalColumn.id);
    const changed = new DatabaseSync(file);
    changed.exec("ALTER TABLE child ADD COLUMN note TEXT; DROP TABLE parent;");
    changed.close();
    const second = sources.scan(source.id);
    expect(second.updated).toBe(1);
    expect(second.retired).toBe(1);
    expect(
      database.db
        .prepare("SELECT id,comment FROM meta_columns WHERE name='parent_id'")
        .get(),
    ).toMatchObject({ id: originalColumn.id, comment: "Owned note" });
    expect(database.stats()).toMatchObject({ sources: 1, tables: 2 });
    sources.remove(source.id);
    expect(database.stats().sources).toBe(0);
    database.close();
    fs.unlinkSync(file);
  });
  it("collects field mappings and preserves rejected inferred relationships across rescans", () => {
    const file = path.join(os.tmpdir(), `datamaker-ddl-${Date.now()}.sql`);
    fs.writeFileSync(
      file,
      "CREATE TABLE DEPT (ID NUMBER PRIMARY KEY, NAME VARCHAR2(100));\nCREATE TABLE EMP (ID NUMBER PRIMARY KEY, DEPT_ID NUMBER REFERENCES DEPT(ID), NOTE CLOB);\nCREATE TABLE AUDIT (ID NUMBER PRIMARY KEY, DEPT_ID NUMBER);",
      "utf8",
    );
    const database = new MetadataDatabase(":memory:");
    const sources = new DataSourceRepository(database.db);
    const source = sources.save({
      name: "DDL",
      type: "sql_file",
      filePath: file,
    });
    const summary = sources.scan(source.id);
    expect(summary).toMatchObject({ tables: 3, columns: 7, relations: 2 });
    const relations = database.db
      .prepare("SELECT origin,status FROM table_relations ORDER BY origin")
      .all();
    expect(relations).toEqual([
      { origin: "inferred", status: "candidate" },
      { origin: "physical", status: "confirmed" },
    ]);
    expect(
      database.db.prepare("SELECT COUNT(*) count FROM relation_columns").get(),
    ).toEqual({ count: 2 });
    database.db
      .prepare(
        "UPDATE table_relations SET status='rejected' WHERE origin='inferred'",
      )
      .run();
    sources.scan(source.id);
    expect(
      database.db
        .prepare(
          "SELECT status,COUNT(*) count FROM table_relations WHERE origin='inferred'",
        )
        .get(),
    ).toEqual({ status: "rejected", count: 1 });
    database.close();
    fs.unlinkSync(file);
  });
  it("imports composite primary keys and table-level foreign keys regardless of declaration order", () => {
    const file = path.join(
      os.tmpdir(),
      `datamaker-composite-${Date.now()}.sql`,
    );
    fs.writeFileSync(
      file,
      "CREATE TABLE PARENT (A NUMBER, B NUMBER, PRIMARY KEY (A, B));\nCREATE TABLE CHILD (A NUMBER, B NUMBER, VALUE BLOB, CONSTRAINT FK_CHILD FOREIGN KEY (A, B) REFERENCES PARENT(A, B), CONSTRAINT UQ_CHILD_VALUE UNIQUE (VALUE), PRIMARY KEY (A, B));",
      "utf8",
    );
    const database = new MetadataDatabase(":memory:");
    const sources = new DataSourceRepository(database.db);
    const source = sources.save({
      name: "Composite",
      type: "sql_file",
      filePath: file,
    });
    const summary = sources.scan(source.id);
    expect(summary).toMatchObject({ tables: 2, columns: 5, relations: 1 });
    const keys = database.db
      .prepare(
        "SELECT primary_key_ordinal ordinal FROM meta_columns WHERE name IN ('A','B') ORDER BY table_id,primary_key_ordinal",
      )
      .all();
    expect(keys).toHaveLength(4);
    expect(keys.every((item: any) => item.ordinal > 0)).toBe(true);
    expect(
      database.db
        .prepare("SELECT ordinal FROM relation_columns ORDER BY ordinal")
        .all(),
    ).toEqual([{ ordinal: 1 }, { ordinal: 2 }]);
    expect(
      database.db
        .prepare("SELECT COUNT(*) count FROM meta_indexes WHERE origin='u'")
        .get(),
    ).toEqual({ count: 1 });
    database.close();
    fs.unlinkSync(file);
  });
  it("preserves original DDL, defaults, and SQL comments", () => {
    const file = path.join(os.tmpdir(), `datamaker-comments-${Date.now()}.sql`);
    fs.writeFileSync(
      file,
      "CREATE TABLE ACCOUNT (ID NUMBER DEFAULT 10 PRIMARY KEY, STATUS VARCHAR2(20) DEFAULT 'active' COMMENT 'Inline status');\nCOMMENT ON TABLE account IS 'Account master';\nCOMMENT ON COLUMN account.id IS 'Primary identifier';",
      "utf8",
    );
    const database = new MetadataDatabase(":memory:");
    const sources = new DataSourceRepository(database.db);
    const source = sources.save({
      name: "Comments",
      type: "sql_file",
      filePath: file,
    });
    sources.scan(source.id);
    const table = database.db
      .prepare("SELECT comment,raw_ddl FROM meta_tables WHERE name=?")
      .get("ACCOUNT") as { comment: string; raw_ddl: string };
    expect(table.comment).toBe("Account master");
    expect(table.raw_ddl).toContain("DEFAULT 10");
    const columns = database.db
      .prepare(
        "SELECT name,default_value defaultValue,comment FROM meta_columns ORDER BY ordinal",
      )
      .all();
    expect(columns).toEqual([
      { name: "ID", defaultValue: "10", comment: "Primary identifier" },
      { name: "STATUS", defaultValue: "'active'", comment: "Inline status" },
    ]);
    database.close();
    fs.unlinkSync(file);
  });

  it("detects GBK SQL files and preserves Chinese comments", () => {
    const file = path.join(os.tmpdir(), `datamaker-gbk-${Date.now()}.sql`);
    fs.writeFileSync(
      file,
      Buffer.concat([
        Buffer.from(
          "CREATE TABLE CUSTOMER (ID NUMBER PRIMARY KEY);\nCOMMENT ON TABLE CUSTOMER IS '",
          "ascii",
        ),
        Buffer.from([0xbf, 0xcd, 0xbb, 0xa7]),
        Buffer.from("';", "ascii"),
      ]),
    );
    const database = new MetadataDatabase(":memory:");
    const sources = new DataSourceRepository(database.db);
    const source = sources.save({
      name: "GBK",
      type: "sql_file",
      filePath: file,
    });
    sources.scan(source.id);
    expect(
      database.db
        .prepare("SELECT comment FROM meta_tables WHERE name='CUSTOMER'")
        .get(),
    ).toEqual({ comment: "客户" });
    database.close();
    fs.unlinkSync(file);
  });
  it("reports unsupported SQL definitions instead of silently dropping them", () => {
    const file = path.join(os.tmpdir(), `datamaker-warning-${Date.now()}.sql`);
    fs.writeFileSync(
      file,
      "CREATE TABLE SAMPLE (ID NUMBER, BROKEN_DEFINITION);",
      "utf8",
    );
    const database = new MetadataDatabase(":memory:");
    const sources = new DataSourceRepository(database.db);
    const source = sources.save({
      name: "Warnings",
      type: "sql_file",
      filePath: file,
    });
    const summary = sources.scan(source.id);
    expect(summary.tables).toBe(1);
    expect(summary.warnings).toEqual([
      expect.stringContaining("BROKEN_DEFINITION"),
    ]);
    database.close();
    fs.unlinkSync(file);
  });

  it("converts legacy META_TABLE and META_COLUMN rows into an isolated catalog", () => {
    const file = path.join(os.tmpdir(), `datamaker-legacy-${Date.now()}.sql`);
    fs.writeFileSync(
      file,
      `CREATE TABLE "OLD"."META_TABLE" ("MT_ID" VARCHAR(64), "MT_NAME_CN" VARCHAR(100), "MT_NAME" VARCHAR(100));
CREATE TABLE "OLD"."META_COLUMN" ("MC_ID" VARCHAR(64), "MT_NAME" VARCHAR(100), "MC_NAME_CN" VARCHAR(100), "MC_NAME" VARCHAR(100), "MC_TYPE" VARCHAR(10), "MC_LENGTH" INTEGER, "MC_PRECISION" INTEGER, "MC_IS_REQUIRED" INTEGER, "MC_ORDER" INTEGER);
INSERT INTO "OLD"."META_TABLE"("MT_ID","MT_NAME_CN","MT_NAME") VALUES('t1','客户档案','CUSTOMER');
INSERT INTO "OLD"."META_COLUMN"("MC_ID","MT_NAME","MC_NAME_CN","MC_NAME","MC_TYPE","MC_LENGTH","MC_PRECISION","MC_IS_REQUIRED","MC_ORDER") VALUES('c1','CUSTOMER','客户编号','CUSTOMER_ID','varchar',64,0,1,2);`,
      "utf8",
    );
    const database = new MetadataDatabase(":memory:");
    const sources = new DataSourceRepository(database.db);
    const source = sources.save({
      name: "Legacy",
      type: "sql_file",
      filePath: file,
    });
    const preview = sources.preview(source.id);
    expect(preview.added).toContain("[legacy] CUSTOMER");
    const summary = sources.scan(source.id);
    expect(summary.warnings).toContain(
      "Legacy metadata conversion: 1 tables, 1 columns, 0 orphan columns.",
    );
    expect(
      database.db
        .prepare(
          `SELECT table_object.name,table_object.comment,column_object.name columnName,column_object.raw_type rawType,column_object.nullable
           FROM meta_tables table_object
           JOIN schemas schema_object ON schema_object.id=table_object.schema_id
           JOIN catalogs catalog ON catalog.id=schema_object.catalog_id
           JOIN meta_columns column_object ON column_object.table_id=table_object.id
           WHERE catalog.name='legacy-metadata'`,
        )
        .get(),
    ).toEqual({
      name: "CUSTOMER",
      comment: "客户档案",
      columnName: "CUSTOMER_ID",
      rawType: "varchar(64)",
      nullable: 0,
    });
    expect(database.search("客户").length).toBeGreaterThan(0);
    expect(sources.preview(source.id).unchanged).toBe(3);
    database.close();
    fs.unlinkSync(file);
  });
});
