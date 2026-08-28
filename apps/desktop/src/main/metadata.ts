import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  MetadataColumnDto,
  MetadataIndexDto,
  MetadataTableDto,
  MetadataTableOptionDto,
  MetadataTablePageDto,
  MetadataTableQuery,
  RelationDto,
  SaveRelationInput,
  SavedQueryDto,
  UpdateMetadataObjectInput,
} from "@datamaker/contracts";
import { bumpMetadataRevision } from "./revisions.js";

export class MetadataRepository {
  constructor(private readonly db: DatabaseSync) {}
  private hydrateTables(
    tables: Array<
      Omit<MetadataTableDto, "columns" | "indexes" | "retired" | "tags"> & {
        retired: number;
      }
    >,
  ): MetadataTableDto[] {
    const statement = this.db.prepare(
      `SELECT id,name,ordinal,raw_type rawType,normalized_type normalizedType,nullable,default_value defaultValue,comment,primary_key_ordinal primaryKeyOrdinal FROM meta_columns WHERE table_id=? ORDER BY ordinal`,
    );
    const tags = this.db.prepare(
      "SELECT tag.name FROM object_tags assignment JOIN tags tag ON tag.id=assignment.tag_id WHERE assignment.object_type=? AND assignment.object_id=? ORDER BY tag.name",
    );
    const tagNames = (type: string, id: string) =>
      (tags.all(type, id) as Array<{ name: string }>).map((tag) => tag.name);
    const indexes = this.db.prepare(
      "SELECT id,name,unique_flag uniqueFlag,origin,columns_json columnsJson,raw_ddl rawDdl FROM meta_indexes WHERE table_id=? ORDER BY name",
    );
    return tables.map((table) => ({
      ...table,
      retired: Boolean(table.retired),
      tags: tagNames("table", table.id),
      columns: (
        statement.all(table.id) as Array<
          Omit<MetadataColumnDto, "nullable" | "tags"> & { nullable: number }
        >
      ).map((column) => ({
        ...column,
        nullable: Boolean(column.nullable),
        tags: tagNames("column", column.id),
      })),
      indexes: (
        indexes.all(table.id) as Array<{
          id: string;
          name: string;
          uniqueFlag: number;
          origin: string;
          columnsJson: string;
          rawDdl: string | null;
        }>
      ).map(
        (index) =>
          ({
            id: index.id,
            name: index.name,
            unique: Boolean(index.uniqueFlag),
            origin: index.origin,
            columns: JSON.parse(index.columnsJson) as string[],
            rawDdl: index.rawDdl,
          }) satisfies MetadataIndexDto,
      ),
    }));
  }
  listTables(): MetadataTableDto[] {
    const tables = this.db
      .prepare(
        `SELECT table_object.id, source.id sourceId, source.name sourceName, schema_object.name schemaName,
      table_object.name,table_object.object_type objectType,table_object.comment,table_object.raw_ddl rawDdl,table_object.retired,table_object.updated_at updatedAt
      FROM meta_tables table_object JOIN schemas schema_object ON schema_object.id=table_object.schema_id JOIN catalogs catalog ON catalog.id=schema_object.catalog_id JOIN data_sources source ON source.id=catalog.data_source_id
      ORDER BY source.name,schema_object.name,table_object.name`,
      )
      .all() as unknown as Array<
      Omit<MetadataTableDto, "columns" | "indexes" | "tags" | "retired"> & {
        retired: number;
      }
    >;
    return this.hydrateTables(tables);
  }
  listTablePage(query: MetadataTableQuery = {}): MetadataTablePageDto {
    const page = Math.max(1, Math.trunc(query.page ?? 1)),
      pageSize = Math.min(100, Math.max(10, Math.trunc(query.pageSize ?? 20))),
      search = (query.search ?? "").trim();
    const where = search
      ? `WHERE table_object.name LIKE ? ESCAPE '\\' OR table_object.comment LIKE ? ESCAPE '\\' OR source.name LIKE ? ESCAPE '\\' OR schema_object.name LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM meta_columns column_object WHERE column_object.table_id=table_object.id AND (column_object.name LIKE ? ESCAPE '\\' OR column_object.comment LIKE ? ESCAPE '\\'))`
      : "";
    const escaped = `%${search.replace(/[\\%_]/g, (value) => `\\${value}`)}%`,
      params = search
        ? [escaped, escaped, escaped, escaped, escaped, escaped]
        : [];
    const from = `FROM meta_tables table_object JOIN schemas schema_object ON schema_object.id=table_object.schema_id JOIN catalogs catalog ON catalog.id=schema_object.catalog_id JOIN data_sources source ON source.id=catalog.data_source_id ${where}`;
    const total = Number(
      (
        this.db.prepare(`SELECT COUNT(*) total ${from}`).get(...params) as {
          total: number;
        }
      ).total,
    );
    const rows = this.db
      .prepare(
        `SELECT table_object.id,source.id sourceId,source.name sourceName,schema_object.name schemaName,table_object.name,table_object.object_type objectType,table_object.comment,table_object.raw_ddl rawDdl,table_object.retired,table_object.updated_at updatedAt ${from} ORDER BY source.name,schema_object.name,table_object.name LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize) as unknown as Array<
      Omit<MetadataTableDto, "columns" | "indexes" | "retired" | "tags"> & {
        retired: number;
      }
    >;
    return { items: this.hydrateTables(rows), total, page, pageSize };
  }
  listTableOptions(): MetadataTableOptionDto[] {
    return (
      this.db
        .prepare(
          `SELECT table_object.id,source.id sourceId,source.name sourceName,schema_object.name schemaName,table_object.name,table_object.retired FROM meta_tables table_object JOIN schemas schema_object ON schema_object.id=table_object.schema_id JOIN catalogs catalog ON catalog.id=schema_object.catalog_id JOIN data_sources source ON source.id=catalog.data_source_id ORDER BY source.name,schema_object.name,table_object.name`,
        )
        .all() as Array<{
        id: string;
        sourceId: string;
        sourceName: string;
        schemaName: string;
        name: string;
        retired: number;
      }>
    ).map((row) => ({ ...row, retired: Boolean(row.retired) }));
  }
  getTable(id: string): MetadataTableDto {
    const direct = this.db
      .prepare(
        `SELECT table_object.id,source.id sourceId,source.name sourceName,schema_object.name schemaName,table_object.name,table_object.object_type objectType,table_object.comment,table_object.raw_ddl rawDdl,table_object.retired,table_object.updated_at updatedAt FROM meta_tables table_object JOIN schemas schema_object ON schema_object.id=table_object.schema_id JOIN catalogs catalog ON catalog.id=schema_object.catalog_id JOIN data_sources source ON source.id=catalog.data_source_id WHERE table_object.id=?`,
      )
      .get(id) as unknown as
      | (Omit<MetadataTableDto, "columns" | "indexes" | "retired" | "tags"> & {
          retired: number;
        })
      | undefined;
    if (!direct) throw new Error("Metadata table not found");
    return this.hydrateTables([direct])[0]!;
  }
  listRelations(): RelationDto[] {
    const relations = this.db
      .prepare(
        `SELECT relation.id,relation.source_table_id sourceTableId,source.name sourceTableName,relation.target_table_id targetTableId,target.name targetTableName,
      relation.relation_type relationType,relation.origin,relation.confidence,relation.status,relation.evidence FROM table_relations relation JOIN meta_tables source ON source.id=relation.source_table_id JOIN meta_tables target ON target.id=relation.target_table_id ORDER BY source.name,target.name`,
      )
      .all() as unknown as RelationDto[];
    const mappings = this.db.prepare(
      "SELECT source.id sourceColumnId,source.name sourceColumnName,target.id targetColumnId,target.name targetColumnName,mapping.ordinal FROM relation_columns mapping JOIN meta_columns source ON source.id=mapping.source_column_id JOIN meta_columns target ON target.id=mapping.target_column_id WHERE mapping.relation_id=? ORDER BY mapping.ordinal",
    );
    return relations.map((relation) => {
      const details = mappings.all(
        relation.id,
      ) as unknown as RelationDto["columnMappingDetails"];
      return {
        ...relation,
        columnMappings: details.map(
          (item) => `${item.sourceColumnName} → ${item.targetColumnName}`,
        ),
        columnMappingDetails: details,
      };
    });
  }
  saveRelation(input: SaveRelationInput): RelationDto {
    const allowedTypes = new Set([
      "one_to_one",
      "one_to_many",
      "many_to_one",
      "many_to_many",
    ]);
    if (!allowedTypes.has(input.relationType))
      throw new Error("Relation type is invalid");
    if (input.sourceTableId === input.targetTableId)
      throw new Error("A table cannot relate to itself");
    if ((input.evidence ?? "").length > 1000)
      throw new Error("Relation evidence cannot exceed 1000 characters");
    const endpoints = Number(
      (
        this.db
          .prepare(
            "SELECT COUNT(*) count FROM meta_tables WHERE id IN (?,?) AND retired=0",
          )
          .get(input.sourceTableId, input.targetTableId) as { count: number }
      ).count,
    );
    if (endpoints !== 2)
      throw new Error(
        "Relation endpoints must reference active metadata tables",
      );
    const mappings = input.columnMappings ?? [];
    if (
      new Set(mappings.map((mapping) => mapping.sourceColumnId)).size !==
        mappings.length ||
      new Set(mappings.map((mapping) => mapping.targetColumnId)).size !==
        mappings.length
    )
      throw new Error("Relation field mappings cannot contain duplicates");
    const id = input.id ?? randomUUID();
    this.db.exec("BEGIN");
    try {
      if (input.id) {
        const existing = this.db
          .prepare("SELECT origin FROM table_relations WHERE id=?")
          .get(id) as { origin: string } | undefined;
        if (!existing) throw new Error("Relation not found");
        if (existing.origin === "physical")
          throw new Error("Physical relations cannot be modified");
        this.db
          .prepare(
            "UPDATE table_relations SET source_table_id=?,target_table_id=?,relation_type=?,status=?,evidence=? WHERE id=?",
          )
          .run(
            input.sourceTableId,
            input.targetTableId,
            input.relationType,
            input.status,
            input.evidence ?? null,
            id,
          );
      } else
        this.db
          .prepare(
            "INSERT INTO table_relations(id,source_table_id,target_table_id,relation_type,origin,confidence,status,evidence) VALUES(?,?,?,?, 'manual',1,?,?)",
          )
          .run(
            id,
            input.sourceTableId,
            input.targetTableId,
            input.relationType,
            input.status,
            input.evidence ?? null,
          );
      this.db
        .prepare("DELETE FROM relation_columns WHERE relation_id=?")
        .run(id);
      const insert = this.db.prepare(
        "INSERT INTO relation_columns(relation_id,source_column_id,target_column_id,ordinal) VALUES(?,?,?,?)",
      );
      for (const [ordinal, mapping] of mappings.entries()) {
        const source = this.db
            .prepare("SELECT 1 FROM meta_columns WHERE id=? AND table_id=?")
            .get(mapping.sourceColumnId, input.sourceTableId),
          target = this.db
            .prepare("SELECT 1 FROM meta_columns WHERE id=? AND table_id=?")
            .get(mapping.targetColumnId, input.targetTableId);
        if (!source || !target)
          throw new Error("Relation column mapping does not match its table");
        insert.run(
          id,
          mapping.sourceColumnId,
          mapping.targetColumnId,
          ordinal + 1,
        );
      }
      this.db
        .prepare("UPDATE meta_tables SET updated_at=? WHERE id IN (?,?)")
        .run(
          new Date().toISOString(),
          input.sourceTableId,
          input.targetTableId,
        );
      bumpMetadataRevision(this.db);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listRelations().find((relation) => relation.id === id)!;
  }
  removeRelation(id: string) {
    const relation = this.db
      .prepare(
        "SELECT source_table_id sourceTableId,target_table_id targetTableId,origin FROM table_relations WHERE id=?",
      )
      .get(id) as
      | { sourceTableId: string; targetTableId: string; origin: string }
      | undefined;
    if (!relation) throw new Error("Relation not found");
    if (relation.origin === "physical")
      throw new Error("Physical relations cannot be deleted");
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM table_relations WHERE id=?").run(id);
      this.db
        .prepare("UPDATE meta_tables SET updated_at=? WHERE id IN (?,?)")
        .run(
          new Date().toISOString(),
          relation.sourceTableId,
          relation.targetTableId,
        );
      bumpMetadataRevision(this.db);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  updateObject(input: UpdateMetadataObjectInput) {
    const table = input.objectType === "table" ? "meta_tables" : "meta_columns";
    const row = this.db
      .prepare(`SELECT id,name FROM ${table} WHERE id=?`)
      .get(input.objectId) as { id: string; name: string } | undefined;
    if (!row) throw new Error("Metadata object not found");
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(`UPDATE ${table} SET comment=? WHERE id=?`)
        .run(input.comment.trim() || null, input.objectId);
      const changedAt = new Date().toISOString();
      if (input.objectType === "table")
        this.db
          .prepare("UPDATE meta_tables SET updated_at=? WHERE id=?")
          .run(changedAt, input.objectId);
      else
        this.db
          .prepare(
            "UPDATE meta_tables SET updated_at=? WHERE id=(SELECT table_id FROM meta_columns WHERE id=?)",
          )
          .run(changedAt, input.objectId);
      this.db
        .prepare("DELETE FROM object_tags WHERE object_type=? AND object_id=?")
        .run(input.objectType, input.objectId);
      const addTag = this.db.prepare(
        "INSERT OR IGNORE INTO tags(id,name) VALUES(?,?)",
      );
      const findTag = this.db.prepare(
        "SELECT id FROM tags WHERE name=? COLLATE NOCASE",
      );
      const assign = this.db.prepare(
        "INSERT INTO object_tags(object_type,object_id,tag_id) VALUES(?,?,?)",
      );
      for (const name of [
        ...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean)),
      ]) {
        addTag.run(randomUUID(), name);
        const tagId = (findTag.get(name) as { id: string }).id;
        assign.run(input.objectType, input.objectId, tagId);
      }
      const names = input.tags.join(" ");
      this.db
        .prepare(
          "UPDATE metadata_fts SET comment=? WHERE object_id=? AND object_type=?",
        )
        .run(
          `${input.comment} ${names}`.trim(),
          input.objectId,
          input.objectType,
        );
      bumpMetadataRevision(this.db);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  listSavedQueries(userId: string | null = null): SavedQueryDto[] {
    return this.db
      .prepare(
        "SELECT id,name,query_text query,created_at createdAt FROM saved_queries WHERE user_id IS ? ORDER BY name",
      )
      .all(userId) as unknown as SavedQueryDto[];
  }
  saveQuery(
    name: string,
    query: string,
    userId: string | null = null,
  ): SavedQueryDto {
    if (!name.trim() || !query.trim())
      throw new Error("Query name and text are required");
    const existing = this.db
      .prepare("SELECT id FROM saved_queries WHERE user_id IS ? AND name=?")
      .get(userId, name.trim()) as { id: string } | undefined;
    const id = existing?.id ?? randomUUID();
    if (existing)
      this.db
        .prepare("UPDATE saved_queries SET query_text=? WHERE id=?")
        .run(query.trim(), id);
    else
      this.db
        .prepare(
          "INSERT INTO saved_queries(id,user_id,name,query_text,created_at) VALUES(?,?,?,?,?)",
        )
        .run(id, userId, name.trim(), query.trim(), new Date().toISOString());
    return this.listSavedQueries(userId).find((item) => item.id === id)!;
  }
  removeSavedQuery(id: string, userId: string | null = null) {
    if (
      !this.db
        .prepare("DELETE FROM saved_queries WHERE id=? AND user_id IS ?")
        .run(id, userId).changes
    )
      throw new Error("Saved query not found");
  }
}
