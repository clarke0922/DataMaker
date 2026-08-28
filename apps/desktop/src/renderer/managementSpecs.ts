import type { ManagementModule } from "@datamaker/contracts";
type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;
export type Field = {
  key: string;
  label: string;
  type?: "text" | "number" | "boolean" | "select" | "parent" | "category";
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
};
type Spec = { title: string; description: string; fields: Field[] };
const tableFields = (t: Translate, includePublic: boolean): Field[] => {
  const fields: Field[] = [
    { key: "name", label: t("Physical Name"), required: true },
    { key: "display_name", label: t("Display Name"), required: true },
    { key: "category_id", label: t("Category"), type: "category" },
    { key: "table_type", label: t("Table Type") },
    { key: "is_tree", label: t("Tree Table"), type: "boolean" },
    { key: "is_internal", label: t("Internal Table"), type: "boolean" },
  ];
  if (includePublic)
    fields.push({
      key: "is_public",
      label: t("Public Table"),
      type: "boolean",
    });
  fields.push(
    { key: "owner", label: t("Owner") },
    { key: "row_count", label: t("Row Count"), type: "number" },
    { key: "is_search_indexed", label: t("Full-text Index"), type: "boolean" },
    { key: "description", label: t("Description") },
  );
  return fields;
};
export function getManagementSpecs(
  t: Translate,
): Record<ManagementModule, Spec> {
  return {
    weights: {
      title: t("Weight Score Management"),
      description: t("Maintain field importance levels and scores."),
      fields: [
        { key: "name", label: t("Weight Name"), required: true },
        {
          key: "score",
          label: t("Weight Score"),
          type: "number",
          required: true,
        },
        { key: "display_order", label: t("Order"), type: "number" },
      ],
    },
    dictionaries: {
      title: t("Dictionary Data Management"),
      description: t("Maintain codes, descriptions, and order in a list."),
      fields: [],
    },
    dictionaryTree: {
      title: t("Tree Dictionary Management"),
      description: t(
        "Maintain hierarchical dictionary data using parent-child relationships.",
      ),
      fields: [],
    },
    factors: {
      title: t("Factor Management"),
      description: t(
        "Maintain business factors and groups of equivalent fields.",
      ),
      fields: [
        { key: "name", label: t("Factor Name"), required: true },
        { key: "description", label: t("Description") },
        { key: "owner", label: t("Created By") },
      ],
    },
    imports: {
      title: t("External Data Import"),
      description: t(
        "Import table metadata from SQL, SQLite, or Excel files and track each job.",
      ),
      fields: [
        { key: "source_name", label: t("Source File"), required: true },
        {
          key: "source_type",
          label: t("Source Type"),
          type: "select",
          required: true,
          options: [
            { label: t("SQL File"), value: "sql" },
            { label: "SQLite", value: "sqlite" },
            { label: "Excel", value: "excel" },
          ],
        },
        { key: "target_name", label: t("Target Prefix") },
        {
          key: "status",
          label: t("Status"),
          type: "select",
          options: ["pending", "running", "completed", "failed"].map(
            (value) => ({
              value,
              label: t(value[0]!.toUpperCase() + value.slice(1)),
            }),
          ),
        },
        { key: "imported_rows", label: t("Imported Objects"), type: "number" },
        { key: "error_message", label: t("Error Message") },
      ],
    },
    tables: {
      title: t("Data Table Management"),
      description: t(
        "Maintain business tables and their visibility, hierarchy, and indexing metadata.",
      ),
      fields: tableFields(t, true),
    },
    privateTables: {
      title: t("Private Table Management"),
      description: t("Display and maintain non-public data tables only."),
      fields: tableFields(t, false),
    },
    dailyCounts: {
      title: t("Daily Table Count Management"),
      description: t(
        "Track daily increments and cumulative totals for each table.",
      ),
      fields: [
        { key: "table_name", label: t("Table Name"), required: true },
        { key: "daily_increase", label: t("Daily Increase"), type: "number" },
        { key: "total_count", label: t("Total Count"), type: "number" },
        { key: "stat_date", label: t("Statistics Date"), required: true },
      ],
    },
    cubes: {
      title: t("Data Cube Management"),
      description: t(
        "Maintain analytical relationship models between data tables.",
      ),
      fields: [
        { key: "name", label: t("Cube Name"), required: true },
        { key: "description", label: t("Description") },
        { key: "definition_json", label: t("Relationship Definition JSON") },
      ],
    },
    categories: {
      title: t("Table Category Management"),
      description: t("Maintain the table category tree and display order."),
      fields: [
        { key: "name", label: t("Category Name"), required: true },
        { key: "parent_id", label: t("Parent Category"), type: "parent" },
        { key: "level_path", label: t("Hierarchy Path") },
        { key: "display_order", label: t("Order"), type: "number" },
      ],
    },
    dictionaryDefinitions: {
      title: t("Dictionary Management"),
      description: t(
        "Create dictionaries, then maintain their values and order.",
      ),
      fields: [],
    },
    dictionaryValues: {
      title: t("Dictionary Data Management"),
      description: t("Maintain dictionary data."),
      fields: [],
    },
  };
}
