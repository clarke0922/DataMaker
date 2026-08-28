import { describe, expect, it } from "vitest";
import { MetadataDatabase } from "../src/main/database.js";
import { MetadataRepository } from "../src/main/metadata.js";

describe("MetadataRepository", () => {
  it("lists tables and manages logical relations while protecting physical relations", () => {
    const database = new MetadataDatabase(":memory:");
    const now = new Date().toISOString();
    database.db.exec(
      "INSERT INTO data_sources(id,name,type,created_at,updated_at) VALUES('s','S','sqlite','x','x'); INSERT INTO catalogs(id,data_source_id,name) VALUES('c','s','main'); INSERT INTO schemas(id,catalog_id,name) VALUES('h','c','main');",
    );
    const insert = database.db.prepare(
      "INSERT INTO meta_tables(id,schema_id,name,fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    );
    insert.run("a", "h", "A", "1", now, now);
    insert.run("b", "h", "B", "2", now, now);
    database.db
      .prepare(
        "INSERT INTO meta_columns(id,table_id,name,ordinal,raw_type,normalized_type,nullable) VALUES('col','a','id',1,'INTEGER','integer',0)",
      )
      .run();
    database.db
      .prepare(
        "INSERT INTO meta_columns(id,table_id,name,ordinal,raw_type,normalized_type,nullable) VALUES('target-col','b','a_id',1,'INTEGER','integer',0)",
      )
      .run();
    const repository = new MetadataRepository(database.db);
    expect(repository.listTables()[0]?.columns).toHaveLength(1);
    database.db
      .prepare(
        "INSERT INTO metadata_fts(object_id,object_type,name,path,comment) VALUES('a','table','A','S/A','')",
      )
      .run();
    repository.updateObject({
      objectType: "table",
      objectId: "a",
      comment: "Customer master",
      tags: ["reference", "gold"],
    });
    expect(repository.listTables()[0]).toMatchObject({
      comment: "Customer master",
      tags: ["gold", "reference"],
    });
    expect(database.search("gold")).toHaveLength(1);
    const saved = repository.saveQuery("Gold objects", "gold");
    expect(repository.listSavedQueries()).toHaveLength(1);
    repository.saveQuery("Gold objects", "gold reference");
    expect(repository.listSavedQueries()[0]?.query).toBe("gold reference");
    repository.removeSavedQuery(saved.id);
    expect(repository.listSavedQueries()).toEqual([]);
    const relation = repository.saveRelation({
      sourceTableId: "a",
      targetTableId: "b",
      relationType: "one_to_many",
      status: "confirmed",
      evidence: "business key",
      columnMappings: [{ sourceColumnId: "col", targetColumnId: "target-col" }],
    });
    expect(relation.origin).toBe("manual");
    expect(relation.columnMappingDetails).toHaveLength(1);
    expect(relation.columnMappings).toEqual(["id → a_id"]);
    expect(() =>
      repository.saveRelation({
        sourceTableId: "a",
        targetTableId: "b",
        relationType: "unsupported",
        status: "candidate",
      }),
    ).toThrow("Relation type is invalid");
    expect(() =>
      repository.saveRelation({
        sourceTableId: "a",
        targetTableId: "b",
        relationType: "one_to_many",
        status: "candidate",
        columnMappings: [
          { sourceColumnId: "col", targetColumnId: "target-col" },
          { sourceColumnId: "col", targetColumnId: "target-col" },
        ],
      }),
    ).toThrow("cannot contain duplicates");
    repository.removeRelation(relation.id);
    expect(repository.listRelations()).toEqual([]);
    database.db
      .prepare(
        "INSERT INTO table_relations(id,source_table_id,target_table_id,origin,status) VALUES('p','a','b','physical','confirmed')",
      )
      .run();
    expect(() =>
      repository.saveRelation({
        id: "p",
        sourceTableId: "a",
        targetTableId: "b",
        relationType: "many_to_one",
        status: "confirmed",
      }),
    ).toThrow("Physical relations cannot be modified");
    expect(() => repository.removeRelation("p")).toThrow(
      "Physical relations cannot be deleted",
    );
    database.close();
  });
  it("isolates saved queries by local user", () => {
    const database = new MetadataDatabase(":memory:");
    database.db.exec(
      "INSERT INTO users(id,username,password_hash,display_name,status,created_at,updated_at) VALUES('u1','one','x','One','active','x','x'),('u2','two','x','Two','active','x','x')",
    );
    const repository = new MetadataRepository(database.db);
    const first = repository.saveQuery("Recent", "customer", "u1");
    repository.saveQuery("Recent", "orders", "u2");
    expect(repository.listSavedQueries("u1").map((item) => item.query)).toEqual(
      ["customer"],
    );
    expect(repository.listSavedQueries("u2").map((item) => item.query)).toEqual(
      ["orders"],
    );
    expect(() => repository.removeSavedQuery(first.id, "u2")).toThrow(
      "Saved query not found",
    );
    repository.removeSavedQuery(first.id, "u1");
    expect(repository.listSavedQueries("u1")).toEqual([]);
    database.close();
  });
  it("paginates metadata in SQLite and searches table and field names", () => {
    const database = new MetadataDatabase(":memory:");
    const now = new Date().toISOString();
    database.db.exec(
      "INSERT INTO data_sources(id,name,type,created_at,updated_at) VALUES('s','Source','sqlite','x','x');INSERT INTO catalogs(id,data_source_id,name) VALUES('c','s','main');INSERT INTO schemas(id,catalog_id,name) VALUES('h','c','main')",
    );
    const table = database.db.prepare(
      "INSERT INTO meta_tables(id,schema_id,name,fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    );
    for (let index = 1; index <= 25; index++)
      table.run(
        `t${index}`,
        "h",
        `TABLE_${String(index).padStart(2, "0")}`,
        "x",
        now,
        now,
      );
    database.db
      .prepare(
        "INSERT INTO meta_columns(id,table_id,name,ordinal,raw_type,normalized_type,nullable) VALUES('special','t20','customer_number',1,'TEXT','text',0)",
      )
      .run();
    const repository = new MetadataRepository(database.db);
    const second = repository.listTablePage({ page: 2, pageSize: 10 });
    expect(second).toMatchObject({ total: 25, page: 2, pageSize: 10 });
    expect(second.items).toHaveLength(10);
    expect(second.items[0]?.name).toBe("TABLE_11");
    const searched = repository.listTablePage({ search: "customer_number" });
    expect(searched.total).toBe(1);
    expect(searched.items[0]?.name).toBe("TABLE_20");
    expect(repository.listTableOptions()).toHaveLength(25);
    database.close();
  });
});
