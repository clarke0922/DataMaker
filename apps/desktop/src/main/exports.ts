import type {
  ExportDictionaryDto,
  ExportDictionaryInput,
} from "@datamaker/contracts";
import type { MetadataRepository } from "./metadata.js";
import type { QualityRepository } from "./quality.js";

const escape = (value: unknown) =>
  String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
const linkLabel = (value: unknown) =>
  escape(value)
    .replace(/\\/g, "\\\\")
    .replace(/([\[\]])/g, "\\$1");
export class ExportRepository {
  constructor(
    private readonly metadata: MetadataRepository,
    private readonly quality: QualityRepository,
  ) {}
  metadataDictionary(input: ExportDictionaryInput = {}): ExportDictionaryDto {
    const generatedAt = new Date().toISOString();
    const sourceIds = new Set(input.sourceIds ?? []),
      tableIds = new Set(input.tableIds ?? []);
    const tables = this.metadata
      .listTables()
      .filter(
        (table) =>
          !table.retired &&
          (!sourceIds.size || sourceIds.has(table.sourceId)) &&
          (!tableIds.size || tableIds.has(table.id)),
      );
    const relations =
      input.includeRelations === false ? [] : this.metadata.listRelations();
    const issues =
      input.includeQuality === false ? [] : this.quality.listResults();
    const includeRawTypes = input.includeRawTypes !== false;
    const includedTableIds = new Set(tables.map((table) => table.id));
    const relationEndpoint = (id: string, name: string) =>
      includedTableIds.has(id)
        ? `[${linkLabel(name)}](#table-${id})`
        : escape(name);
    let content = `# Metadata Dictionary\n\nGenerated at: ${generatedAt}\n\nTables: ${tables.length}; Relations: ${relations.length}; Quality issues: ${issues.length}.\n\n`;
    for (const table of tables) {
      content += `<a id="table-${table.id}"></a>\n\n## ${escape(table.name)}\n\n- Source: ${escape(table.sourceName)}\n- Schema: ${escape(table.schemaName)}\n- Type: ${escape(table.objectType)}\n- Comment: ${escape(table.comment || "-")}\n- Tags: ${escape(table.tags.join(", ") || "-")}\n\n| # | Field |${includeRawTypes ? " Raw type |" : ""} Normalized type | Nullable | Primary key | Default | Comment | Tags |\n|---:|---|${includeRawTypes ? "---|" : ""}---|---|---|---|---|---|\n`;
      for (const column of table.columns)
        content += `| ${column.ordinal} | ${escape(column.name)} |${includeRawTypes ? ` ${escape(column.rawType)} |` : ""} ${escape(column.normalizedType)} | ${column.nullable ? "Yes" : "No"} | ${column.primaryKeyOrdinal ?? "-"} | ${escape(column.defaultValue ?? "-")} | ${escape(column.comment ?? "-")} | ${escape(column.tags.join(", ") || "-")} |\n`;
      if (table.indexes.length) {
        content +=
          "\n### Indexes\n\n| Name | Unique | Origin | Fields |\n|---|---|---|---|\n";
        for (const index of table.indexes)
          content += `| ${escape(index.name)} | ${index.unique ? "Yes" : "No"} | ${escape(index.origin)} | ${escape(index.columns.join(", "))} |\n`;
      }
      const related = relations.filter(
        (r) => r.sourceTableId === table.id || r.targetTableId === table.id,
      );
      if (related.length) {
        content += "\n### Relations\n\n";
        for (const relation of related)
          content += `- ${relationEndpoint(relation.sourceTableId, relation.sourceTableName)} -> ${relationEndpoint(relation.targetTableId, relation.targetTableName)} (${escape(relation.relationType)}, ${escape(relation.origin)}, ${escape(relation.status)}${relation.columnMappings.length ? `; ${escape(relation.columnMappings.join(", "))}` : ""})\n`;
      }
      const tableIssues = issues.filter(
        (issue) =>
          issue.objectId === table.id ||
          table.columns.some((column) => column.id === issue.objectId),
      );
      if (tableIssues.length) {
        content += "\n### Quality findings\n\n";
        for (const issue of tableIssues)
          content += `- **${escape(issue.severity)}** ${escape(issue.objectName)}: ${escape(issue.message)}\n`;
      }
      content += "\n";
    }
    return {
      fileName: `metadata-dictionary-${generatedAt.slice(0, 10)}.md`,
      content,
      tableCount: tables.length,
      generatedAt,
    };
  }
}
