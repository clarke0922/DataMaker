import { describe, expect, it } from "vitest";
import { MetadataDatabase } from "../src/main/database.js";
import { QualityRepository } from "../src/main/quality.js";
import { bumpMetadataRevision } from "../src/main/revisions.js";

describe("QualityRepository", () => {
  it("runs enabled metadata rules and replaces previous findings", () => {
    const database = new MetadataDatabase(":memory:");
    const now = new Date().toISOString();
    database.db
      .prepare(
        "INSERT INTO data_sources(id,name,type,created_at,updated_at) VALUES('source','Demo','sqlite',?,?)",
      )
      .run(now, now);
    database.db
      .prepare(
        "INSERT INTO catalogs(id,data_source_id,name) VALUES('catalog','source','main')",
      )
      .run();
    database.db
      .prepare(
        "INSERT INTO schemas(id,catalog_id,name) VALUES('schema','catalog','main')",
      )
      .run();
    database.db
      .prepare(
        "INSERT INTO meta_tables(id,schema_id,name,fingerprint,created_at,updated_at) VALUES('table','schema','bad-name','hash',?,?)",
      )
      .run(now, now);
    database.db
      .prepare(
        "INSERT INTO meta_columns(id,table_id,name,ordinal,raw_type,normalized_type,nullable) VALUES('column','table','bad field',1,'CUSTOM','unknown',1)",
      )
      .run();
    database.db
      .prepare(
        "INSERT INTO meta_columns(id,table_id,name,ordinal,raw_type,normalized_type,nullable) VALUES('required','table','owner_id',2,'INTEGER','integer',1)",
      )
      .run();
    database.db
      .prepare(
        "INSERT INTO table_relations(id,source_table_id,target_table_id,origin,status) VALUES('relation','table','table','manual','confirmed')",
      )
      .run();
    const quality = new QualityRepository(database.db);
    const summary = quality.run();
    expect(summary.checkedRules).toBe(7);
    expect(summary.issues).toBeGreaterThanOrEqual(5);
    expect(summary.results.map((result) => result.ruleCode)).toContain(
      "table-primary-key",
    );
    expect(summary.results.map((result) => result.ruleCode)).toContain(
      "object-naming",
    );
    expect(summary.results.map((result) => result.ruleCode)).toContain(
      "column-required",
    );
    expect(summary.results.map((result) => result.ruleCode)).toContain(
      "relation-integrity",
    );
    expect(quality.run().issues).toBe(summary.issues);
    database.close();
  });

  it("allows rules to be disabled", () => {
    const database = new MetadataDatabase(":memory:");
    const quality = new QualityRepository(database.db);
    const rule = quality.listRules()[0]!;
    expect(quality.setRuleEnabled(rule.id, false).enabled).toBe(false);
    expect(
      quality.listRules().find((item) => item.id === rule.id)?.enabled,
    ).toBe(false);
    database.close();
  });

  it("retains findings by run and exposes the latest completed run", () => {
    const database = new MetadataDatabase(":memory:");
    const quality = new QualityRepository(database.db);
    database.db.exec(`
      INSERT INTO rule_runs(id,status,started_at,finished_at) VALUES('run-1','completed','2026-01-01','2026-01-01');
    `);
    quality.run("run-1");
    const ruleId = quality.listRules()[0]!.id;
    database.db
      .prepare(
        "INSERT INTO rule_results(id,rule_id,object_type,object_id,severity,message,created_at,run_id) VALUES('historic',?,'table','missing','warning','historic issue','2026-01-01','run-1')",
      )
      .run(ruleId);
    const firstCount = Number(
      (
        database.db
          .prepare(
            "SELECT COUNT(*) count FROM rule_results WHERE run_id='run-1'",
          )
          .get() as { count: number }
      ).count,
    );
    database.db.exec(`
      INSERT INTO rule_runs(id,status,started_at) VALUES('run-2','running','2026-01-02');
    `);
    quality.run("run-2");
    database.db.exec(
      "UPDATE rule_runs SET status='completed',finished_at='2026-01-02' WHERE id='run-2'",
    );
    expect(
      database.db
        .prepare("SELECT COUNT(*) count FROM rule_results WHERE run_id='run-1'")
        .get(),
    ).toEqual({ count: firstCount });
    expect(quality.listResultPage().total).toBe(
      Number(
        (
          database.db
            .prepare(
              "SELECT COUNT(*) count FROM rule_results WHERE run_id='run-2'",
            )
            .get() as { count: number }
        ).count,
      ),
    );
    database.close();
  });

  it("prevents rule changes while a quality run is active", () => {
    const database = new MetadataDatabase(":memory:");
    const quality = new QualityRepository(database.db);
    const rule = quality.listRules()[0]!;
    database.db.exec(
      "INSERT INTO rule_runs(id,status,started_at) VALUES('running','running','x')",
    );
    expect(() => quality.setRuleEnabled(rule.id, false)).toThrow(
      "while checks are running",
    );
    expect(
      quality.listRules().find((item) => item.id === rule.id)?.enabled,
    ).toBe(true);
    database.close();
  });

  it("validates and applies configurable naming and identifier rules", () => {
    const database = new MetadataDatabase(":memory:");
    const now = new Date().toISOString();
    database.db.exec(`
      INSERT INTO data_sources(id,name,type,created_at,updated_at) VALUES('s','Demo','sqlite','${now}','${now}');
      INSERT INTO catalogs(id,data_source_id,name) VALUES('c','s','main');
      INSERT INTO schemas(id,catalog_id,name) VALUES('sc','c','main');
      INSERT INTO meta_tables(id,schema_id,name,fingerprint,created_at,updated_at) VALUES('t','sc','customer-record','x','${now}','${now}');
      INSERT INTO meta_columns(id,table_id,name,ordinal,raw_type,normalized_type,nullable) VALUES('f','t','customerKey',1,'TEXT','text',1);
    `);
    const quality = new QualityRepository(database.db);
    const naming = quality
      .listRules()
      .find((rule) => rule.code === "object-naming")!;
    quality.updateRule(naming.id, {
      enabled: true,
      severity: "error",
      config: { namingPattern: "^[a-z-]+$" },
    });
    const required = quality
      .listRules()
      .find((rule) => rule.code === "column-required")!;
    quality.updateRule(required.id, {
      enabled: true,
      severity: "warning",
      config: { identifierNames: ["customerKey"], identifierSuffixes: [] },
    });
    const summary = quality.run();
    expect(
      summary.results.some(
        (result) =>
          result.ruleCode === "object-naming" && result.objectId === "f",
      ),
    ).toBe(true);
    expect(
      summary.results.some(
        (result) =>
          result.ruleCode === "column-required" && result.objectId === "f",
      ),
    ).toBe(true);
    expect(() =>
      quality.updateRule(naming.id, {
        enabled: true,
        severity: "warning",
        config: { namingPattern: "[" },
      }),
    ).toThrow("valid regular expression");
    database.close();
  });

  it("marks findings stale using metadata revision snapshots", () => {
    const database = new MetadataDatabase(":memory:");
    const now = new Date().toISOString();
    database.db.exec(`
      INSERT INTO data_sources(id,name,type,created_at,updated_at) VALUES('s','Demo','sqlite','${now}','${now}');
      INSERT INTO catalogs(id,data_source_id,name) VALUES('c','s','main');
      INSERT INTO schemas(id,catalog_id,name) VALUES('sc','c','main');
      INSERT INTO meta_tables(id,schema_id,name,fingerprint,created_at,updated_at) VALUES('t','sc','customers','x','${now}','${now}');
    `);
    const quality = new QualityRepository(database.db);
    expect(quality.listResultPage().stale).toBe(true);
    quality.run();
    expect(quality.listResultPage().stale).toBe(false);
    bumpMetadataRevision(database.db);
    expect(quality.listResultPage().stale).toBe(true);
    database.close();
  });

  it("reports relationship mappings with incompatible field types", () => {
    const database = new MetadataDatabase(":memory:");
    const now = new Date().toISOString();
    database.db.exec(`
      INSERT INTO data_sources(id,name,type,created_at,updated_at) VALUES('s','Demo','sqlite','${now}','${now}');
      INSERT INTO catalogs(id,data_source_id,name) VALUES('c','s','main');
      INSERT INTO schemas(id,catalog_id,name) VALUES('sc','c','main');
      INSERT INTO meta_tables(id,schema_id,name,fingerprint,created_at,updated_at) VALUES('a','sc','orders','a','${now}','${now}');
      INSERT INTO meta_tables(id,schema_id,name,fingerprint,created_at,updated_at) VALUES('b','sc','customers','b','${now}','${now}');
      INSERT INTO meta_columns(id,table_id,name,ordinal,raw_type,normalized_type,nullable) VALUES('ac','a','customer_id',1,'INTEGER','integer',0);
      INSERT INTO meta_columns(id,table_id,name,ordinal,raw_type,normalized_type,nullable) VALUES('bc','b','id',1,'TEXT','text',0);
      INSERT INTO table_relations(id,source_table_id,target_table_id,origin,status) VALUES('r','a','b','manual','confirmed');
      INSERT INTO relation_columns(relation_id,source_column_id,target_column_id,ordinal) VALUES('r','ac','bc',1);
    `);
    const summary = new QualityRepository(database.db).run();
    expect(
      summary.results.some(
        (result) =>
          result.objectId === "r" && result.message.includes("incompatible"),
      ),
    ).toBe(true);
    database.close();
  });

  it("paginates and filters quality findings in SQLite", () => {
    const database = new MetadataDatabase(":memory:");
    const quality = new QualityRepository(database.db);
    const rule = quality.listRules()[0]!;
    const insert = database.db.prepare(
      "INSERT INTO rule_results(id,rule_id,object_type,object_id,severity,message,created_at) VALUES(?,?,?,?,?,?,?)",
    );
    for (let index = 1; index <= 25; index++)
      insert.run(
        `r${index}`,
        rule.id,
        "table",
        `object-${index}`,
        index % 2 ? "warning" : "error",
        index === 20 ? "customer issue" : `issue ${index}`,
        "2026-01-01",
      );
    const second = quality.listResultPage({ page: 2, pageSize: 10 });
    expect(second).toMatchObject({ total: 25, page: 2, pageSize: 10 });
    expect(second.items).toHaveLength(10);
    expect(quality.listResultPage({ search: "customer" }).total).toBe(1);
    expect(quality.listResultPage({ severity: "error" }).total).toBe(12);
    const resolved = quality.updateResult(
      "r20",
      { status: "resolved", resolutionNote: "Metadata was corrected" },
      null,
    );
    expect(resolved).toMatchObject({
      status: "resolved",
      resolutionNote: "Metadata was corrected",
    });
    expect(quality.listResultPage({ status: "resolved" }).total).toBe(1);
    expect(quality.listRules()[0]!.issueCount).toBe(24);
    expect(() =>
      quality.updateResult("r19", { status: "ignored" }, null),
    ).toThrow("Resolution note is required");
    database.close();
  });

  it("filters a table detail to table-level and field-level findings", () => {
    const database = new MetadataDatabase(":memory:");
    const now = new Date().toISOString();
    database.db.exec(`
      INSERT INTO data_sources(id,name,type,created_at,updated_at) VALUES('s','Demo','sqlite','${now}','${now}');
      INSERT INTO catalogs(id,data_source_id,name) VALUES('c','s','main');
      INSERT INTO schemas(id,catalog_id,name) VALUES('sc','c','main');
      INSERT INTO meta_tables(id,schema_id,name,fingerprint,created_at,updated_at) VALUES('t1','sc','customers','1','${now}','${now}'),('t2','sc','orders','2','${now}','${now}');
      INSERT INTO meta_columns(id,table_id,name,ordinal,raw_type,normalized_type,nullable) VALUES('f1','t1','name',1,'TEXT','text',1),('f2','t2','total',1,'INTEGER','integer',1);
    `);
    const quality = new QualityRepository(database.db);
    const rule = quality.listRules()[0]!;
    const insert = database.db.prepare(
      "INSERT INTO rule_results(id,rule_id,object_type,object_id,severity,message,created_at) VALUES(?,?,?,?,?,?,?)",
    );
    insert.run("r1", rule.id, "table", "t1", "warning", "table", now);
    insert.run("r2", rule.id, "column", "f1", "warning", "field", now);
    insert.run("r3", rule.id, "column", "f2", "warning", "other", now);
    const page = quality.listResultPage({ tableId: "t1" });
    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.id).sort()).toEqual(["r1", "r2"]);
    database.close();
  });
});
