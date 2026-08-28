import { describe, expect, it } from "vitest";
import { MetadataDatabase } from "../src/main/database.js";
import { MetadataManagementRepository } from "../src/main/management.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";

describe("MetadataManagementRepository", () => {
  it("initializes every management module and legacy weight defaults", () => {
    const database = new MetadataDatabase(":memory:");
    const repository = new MetadataManagementRepository(database.db);
    expect(
      repository.list("weights").map((item) => [item.name, item.score]),
    ).toEqual([
      ["Required", 80],
      ["Important", 50],
      ["Standard", 20],
    ]);
    for (const module of [
      "dictionaries",
      "dictionaryTree",
      "factors",
      "imports",
      "tables",
      "privateTables",
      "dailyCounts",
      "cubes",
      "categories",
    ] as const) {
      expect(repository.list(module)).toEqual([]);
    }
    database.close();
  });

  it("creates, updates and deletes records", () => {
    const database = new MetadataDatabase(":memory:");
    const repository = new MetadataManagementRepository(database.db);
    const created = repository.save("categories", {
      values: { name: "Reference Data", display_order: 1 },
    });
    expect(repository.list("categories")).toHaveLength(1);
    repository.save("categories", {
      id: created.id,
      values: { name: "Reference Data Category" },
    });
    expect(repository.list("categories")[0]?.name).toBe(
      "Reference Data Category",
    );
    repository.remove("categories", created.id);
    expect(repository.list("categories")).toEqual([]);
    database.close();
  });

  it("creates factors from existing metadata fields and keeps associations atomic", () => {
    const database = new MetadataDatabase(":memory:");
    const repository = new MetadataManagementRepository(database.db);
    const now = new Date().toISOString();
    database.db.exec(`
      INSERT INTO data_sources(id,name,type,created_at,updated_at) VALUES('s','Demo','sqlite','${now}','${now}');
      INSERT INTO catalogs(id,data_source_id,name) VALUES('c','s','main');
      INSERT INTO schemas(id,catalog_id,name) VALUES('sc','c','main');
      INSERT INTO meta_tables(id,schema_id,name,fingerprint,created_at,updated_at) VALUES('t','sc','customers','x','${now}','${now}');
      INSERT INTO meta_columns(id,table_id,name,ordinal,raw_type,normalized_type,nullable) VALUES('name','t','name',1,'TEXT','text',1),('code','t','code',2,'TEXT','text',0);
    `);
    const factor = repository.save("factors", {
      values: {
        name: "Customer identity",
        field_ids_json: JSON.stringify(["name", "code", "name"]),
      },
    });
    expect(JSON.parse(String(factor.field_ids_json)).sort()).toEqual([
      "code",
      "name",
    ]);
    expect(() =>
      repository.save("factors", {
        id: factor.id,
        values: { name: "Broken", field_ids_json: "[]" },
      }),
    ).toThrow("Select at least one factor field");
    expect(repository.list("factors")[0]?.name).toBe("Customer identity");
    repository.remove("factors", factor.id);
    expect(
      database.db
        .prepare("SELECT COUNT(*) count FROM metadata_factor_columns")
        .get(),
    ).toEqual({ count: 0 });
    database.close();
  });

  it("keeps private tables out of the public table filter", () => {
    const database = new MetadataDatabase(":memory:");
    const repository = new MetadataManagementRepository(database.db);
    repository.save("tables", {
      values: {
        name: "PUBLIC_DATA",
        display_name: "Public Data",
        is_public: 1,
      },
    });
    repository.save("privateTables", {
      values: {
        name: "PRIVATE_DATA",
        display_name: "Private Data",
        owner: "admin",
      },
    });
    expect(repository.list("tables")).toHaveLength(2);
    expect(repository.list("privateTables").map((item) => item.name)).toEqual([
      "PRIVATE_DATA",
    ]);
    database.close();
  });

  it("manages list and tree dictionary definitions, values, and cascade deletion", () => {
    const database = new MetadataDatabase(":memory:");
    const repository = new MetadataManagementRepository(database.db);
    const list = repository.save("dictionaryDefinitions", {
      values: { name: "Status", code: "status", dictionary_type: "list" },
    });
    const enabled = repository.save("dictionaryValues", {
      values: {
        dictionary_id: list.id,
        value: "Enabled",
        weight: 80,
        display_order: 1,
      },
    });
    expect(repository.list("dictionaryDefinitions")[0]).toMatchObject({
      name: "Status",
      code: "STATUS",
      dictionary_type: "list",
    });
    expect(repository.list("dictionaryValues")[0]).toMatchObject({
      value: "Enabled",
      weight: 80,
      parent_id: null,
    });
    expect(() =>
      repository.save("dictionaryValues", {
        values: { dictionary_id: list.id, value: "Enabled", weight: 20 },
      }),
    ).toThrow();
    repository.save("dictionaryValues", {
      id: enabled.id,
      values: { display_order: 2 },
    });
    expect(repository.list("dictionaryValues")[0]?.display_order).toBe(2);

    const tree = repository.save("dictionaryDefinitions", {
      values: { name: "Region", code: "REGION", dictionary_type: "tree" },
    });
    const country = repository.save("dictionaryValues", {
      values: { dictionary_id: tree.id, value: "China", display_order: 1 },
    });
    repository.save("dictionaryValues", {
      values: {
        dictionary_id: tree.id,
        value: "Beijing",
        parent_id: country.id,
        display_order: 1,
      },
    });
    expect(
      repository
        .list("dictionaryValues")
        .filter((item) => item.dictionary_id === tree.id),
    ).toHaveLength(2);
    repository.remove("dictionaryDefinitions", tree.id);
    expect(
      repository
        .list("dictionaryValues")
        .filter((item) => item.dictionary_id === tree.id),
    ).toEqual([]);
    database.close();
  });

  it("imports table metadata from a SQL file", () => {
    const database = new MetadataDatabase(":memory:");
    const repository = new MetadataManagementRepository(database.db);
    const file = path.join(os.tmpdir(), `datamaker-${Date.now()}.sql`);
    fs.writeFileSync(
      file,
      'CREATE TABLE "DEMO" ("ID" INTEGER);\nCREATE TABLE app.USER_INFO (ID TEXT);',
      "utf8",
    );
    repository.save("imports", {
      values: { source_name: file, source_type: "sql", target_name: "" },
    });
    expect(repository.list("imports")[0]?.status).toBe("completed");
    expect(
      repository
        .list("tables")
        .map((item) => item.name)
        .sort(),
    ).toEqual(["DEMO", "USER_INFO"]);
    fs.unlinkSync(file);
    database.close();
  });
  it("imports Excel worksheets as managed tables with data row counts", () => {
    const database = new MetadataDatabase(":memory:");
    const repository = new MetadataManagementRepository(database.db);
    const file = path.join(os.tmpdir(), `datamaker-${Date.now()}.xlsx`);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["id", "name"],
        [1, "Alpha"],
        [2, "Beta"],
      ]),
      "Customers",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([["id"], [10]]),
      "Orders 2026",
    );
    XLSX.writeFile(workbook, file);
    const job = repository.save("imports", {
      values: { source_name: file, source_type: "excel", target_name: "CRM" },
    });
    expect(job).toMatchObject({ status: "completed", imported_rows: 3 });
    expect(repository.list("tables")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "CRM_Customers",
          display_name: "Customers",
          row_count: 2,
        }),
        expect.objectContaining({
          name: "CRM_Orders_2026",
          display_name: "Orders 2026",
          row_count: 1,
        }),
      ]),
    );
    fs.unlinkSync(file);
    database.close();
  });
});
