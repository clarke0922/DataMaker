import { describe, expect, it } from "vitest";
import { MetadataDatabase } from "../src/main/database.js";
import { MetadataRepository } from "../src/main/metadata.js";
import { QualityRepository } from "../src/main/quality.js";
import { ExportRepository } from "../src/main/exports.js";
import { AuditRepository } from "../src/main/audit.js";
describe("export and audit", () => {
  it("summarizes successful operations by object and user", () => {
    const database = new MetadataDatabase(":memory:");
    const audit = new AuditRepository(database.db);
    database.db.exec("INSERT INTO users(id,username,display_name,password_hash,status,created_at,updated_at) VALUES('u','alice','Alice','x','active','2026-01-01','2026-01-01')");
    audit.runAs("u", () => {
      audit.record("management.create", "table", "1", "success");
      audit.record("management.update", "table", "1", "success");
      audit.record("management.delete", "table", "1", "failure");
    });
    expect(audit.statistics({ groupBy: "object" })).toEqual([
      { group: "table", created: 1, viewed: 0, updated: 1, deleted: 0, other: 0, total: 2 },
    ]);
    expect(audit.statistics({ groupBy: "user" })[0]?.group).toBe("alice");
    database.close();
  });
  it("exports escaped Markdown and records audit context", () => {
    const database = new MetadataDatabase(":memory:");
    const now = new Date().toISOString();
    database.db.exec(
      "INSERT INTO data_sources(id,name,type,created_at,updated_at) VALUES('s','S','sqlite','x','x');INSERT INTO catalogs(id,data_source_id,name) VALUES('c','s','main');INSERT INTO schemas(id,catalog_id,name) VALUES('h','c','main');INSERT INTO users(id,username,password_hash,display_name,status,created_at,updated_at) VALUES('u','auditor','x','Auditor','active','x','x');",
    );
    database.db
      .prepare(
        "INSERT INTO meta_tables(id,schema_id,name,comment,fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run("t", "h", "A|B", "line one\nline two", "x", now, now);
    database.db
      .prepare(
        "INSERT INTO meta_columns(id,table_id,name,ordinal,raw_type,normalized_type,nullable) VALUES('f','t','id',1,'INTEGER','integer',0)",
      )
      .run();
    const metadata = new MetadataRepository(database.db);
    const quality = new QualityRepository(database.db);
    const output = new ExportRepository(metadata, quality).metadataDictionary();
    expect(output.tableCount).toBe(1);
    expect(output.content).toContain("A\\|B");
    expect(output.content).toContain("line one<br>line two");
    const audit = new AuditRepository(database.db);
    audit.runAs("u", () =>
      audit.record("export.dictionary", "metadata", null, "success", {
        tables: 1,
      }),
    );
    expect(audit.list().items[0]).toMatchObject({
      actorUserId: "u",
      actorUsername: "auditor",
      action: "export.dictionary",
      result: "success",
    });
    database.close();
  });
  it("paginates and filters successful and failed audit records", () => {
    const database = new MetadataDatabase(":memory:");
    const audit = new AuditRepository(database.db);
    for (let index = 1; index <= 25; index++)
      audit.record(
        index === 20 ? "source.customer.import" : `source.scan.${index}`,
        "data_source",
        `source-${index}`,
        index % 2 ? "success" : "failure",
        { index },
      );
    expect(audit.list({ page: 2, pageSize: 10 })).toMatchObject({
      total: 25,
      page: 2,
      pageSize: 10,
    });
    expect(audit.list({ page: 2, pageSize: 10 }).items).toHaveLength(10);
    expect(audit.list({ search: "customer" }).total).toBe(1);
    expect(audit.list({ result: "failure" }).total).toBe(12);
    database.close();
  });
  it("redacts and bounds sensitive audit context", () => {
    const database = new MetadataDatabase(":memory:");
    const audit = new AuditRepository(database.db);
    audit.record("security.test", "test", "1", "failure", {
      password: "do-not-store",
      nested: { token: "private", filePath: "C:\\Users\\Alice\\secret.db" },
      error: `Failed at C:\\Users\\Alice\\private.db ${"x".repeat(3000)}`,
    });
    const context = JSON.parse(audit.list().items[0]!.context);
    expect(context.password).toBe("[REDACTED]");
    expect(context.nested.token).toBe("[REDACTED]");
    expect(context.nested.filePath).toBe("secret.db");
    expect(context.error).not.toContain("Alice");
    expect(context.error.length).toBeLessThanOrEqual(2000);
    database.close();
  });
  it("prunes expired and overflowing audit records", () => {
    const database = new MetadataDatabase(":memory:");
    const audit = new AuditRepository(database.db);
    const insert = database.db.prepare(
      "INSERT INTO audit_logs(id,action,result,occurred_at) VALUES(?,?,'success',?)",
    );
    insert.run("old", "old", "2000-01-01T00:00:00.000Z");
    insert.run("one", "recent", new Date(Date.now() - 2000).toISOString());
    insert.run("two", "recent", new Date(Date.now() - 1000).toISOString());
    insert.run("three", "recent", new Date().toISOString());
    expect(audit.prune(180, 2)).toBe(2);
    expect(audit.list().items.map((item) => item.id)).toEqual(["three", "two"]);
    database.close();
  });
});
describe("index export", () => {
  it("includes collected indexes in Markdown", () => {
    const database = new MetadataDatabase(":memory:");
    database.db.exec(
      "INSERT INTO data_sources(id,name,type,created_at,updated_at) VALUES('s','S','sqlite','x','x');INSERT INTO catalogs(id,data_source_id,name) VALUES('c','s','main');INSERT INTO schemas(id,catalog_id,name) VALUES('h','c','main');INSERT INTO meta_tables(id,schema_id,name,fingerprint,created_at,updated_at) VALUES('t','h','T','x','x','x');INSERT INTO meta_columns(id,table_id,name,ordinal,raw_type,normalized_type,nullable) VALUES('f','t','id',1,'INTEGER','integer',0);INSERT INTO meta_indexes(id,table_id,name,unique_flag,origin,columns_json) VALUES('i','t','idx_id',1,'created','[\"id\"]')",
    );
    const output = new ExportRepository(
      new MetadataRepository(database.db),
      new QualityRepository(database.db),
    ).metadataDictionary();
    expect(output.content).toContain("### Indexes");
    expect(output.content).toContain("idx_id");
    database.close();
  });
});
describe("scoped export", () => {
  it("filters selected tables and optional sections", () => {
    const database = new MetadataDatabase(":memory:");
    database.db.exec(
      "INSERT INTO data_sources(id,name,type,created_at,updated_at) VALUES('s','S','sqlite','x','x');INSERT INTO catalogs(id,data_source_id,name) VALUES('c','s','main');INSERT INTO schemas(id,catalog_id,name) VALUES('h','c','main');INSERT INTO meta_tables(id,schema_id,name,fingerprint,created_at,updated_at) VALUES('a','h','A','x','x','x'),('b','h','B','x','x','x');INSERT INTO meta_columns(id,table_id,name,ordinal,raw_type,normalized_type,nullable) VALUES('fa','a','id',1,'NUMBER','number',0),('fb','b','id',1,'TEXT','text',0);INSERT INTO table_relations(id,source_table_id,target_table_id,origin,status) VALUES('r','a','b','manual','confirmed')",
    );
    const exporter = new ExportRepository(
      new MetadataRepository(database.db),
      new QualityRepository(database.db),
    );
    const output = exporter.metadataDictionary({
      tableIds: ["a"],
      includeRelations: false,
      includeQuality: false,
      includeRawTypes: false,
    });
    expect(output.tableCount).toBe(1);
    expect(output.content).toContain("## A");
    expect(output.content).not.toContain("## B");
    expect(output.content).not.toContain("Raw type");
    expect(output.content).not.toContain("### Relations");
    const linked = exporter.metadataDictionary({
      tableIds: ["a", "b"],
      includeRelations: true,
      includeQuality: false,
    });
    expect(linked.content).toContain('<a id="table-a"></a>');
    expect(linked.content).toContain("[A](#table-a) -> [B](#table-b)");
    database.close();
  });
});
