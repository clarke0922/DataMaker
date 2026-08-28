import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  QualityResultDto,
  QualityResultPageDto,
  QualityResultQuery,
  QualityRuleDto,
  QualityRuleConfig,
  UpdateQualityResultInput,
  UpdateQualityRuleInput,
  QualityRunSummaryDto,
} from "@datamaker/contracts";
import { readRevision, writeRevision } from "./revisions.js";

type RuleRow = {
  id: string;
  code: string;
  name: string;
  rule_type: string;
  severity: "info" | "warning" | "error";
  enabled: number;
  config_json: string;
};

const DEFAULT_NAMING_PATTERN = "^[A-Za-z][A-Za-z0-9_]*$";
const DEFAULT_IDENTIFIER_NAMES = ["id"];
const DEFAULT_IDENTIFIER_SUFFIXES = ["_id"];
function parseConfig(value: string): QualityRuleConfig {
  try {
    const parsed = JSON.parse(value || "{}") as QualityRuleConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function normalizeConfig(
  code: string,
  config: QualityRuleConfig,
): QualityRuleConfig {
  if (code === "object-naming") {
    const namingPattern = String(
      config.namingPattern ?? DEFAULT_NAMING_PATTERN,
    ).trim();
    if (!namingPattern || namingPattern.length > 200)
      throw new Error("Naming pattern must contain 1 to 200 characters");
    try {
      new RegExp(namingPattern);
    } catch {
      throw new Error("Naming pattern is not a valid regular expression");
    }
    return { namingPattern };
  }
  if (code === "column-required") {
    const clean = (values: unknown, fallback: string[]) => {
      if (!Array.isArray(values)) return fallback;
      const result = [
        ...new Set(
          values
            .map(String)
            .map((v) => v.trim().toLowerCase())
            .filter(Boolean),
        ),
      ];
      if (result.length > 20 || result.some((value) => value.length > 64))
        throw new Error("Identifier configuration exceeds the allowed size");
      return result;
    };
    return {
      identifierNames: clean(config.identifierNames, DEFAULT_IDENTIFIER_NAMES),
      identifierSuffixes: clean(
        config.identifierSuffixes,
        DEFAULT_IDENTIFIER_SUFFIXES,
      ),
    };
  }
  return {};
}

export class QualityRepository {
  constructor(private readonly db: DatabaseSync) {}

  private currentRunId() {
    return (
      this.db
        .prepare(
          "SELECT id FROM rule_runs WHERE status='completed' ORDER BY finished_at DESC LIMIT 1",
        )
        .get() as { id: string } | undefined
    )?.id;
  }

  listRules(): QualityRuleDto[] {
    const runId = this.currentRunId();
    return (
      this.db
        .prepare(
          `SELECT r.*, COUNT(CASE WHEN result.status='open' THEN 1 END) issue_count
           FROM quality_rules r LEFT JOIN rule_results result ON result.rule_id = r.id
             AND (result.run_id=? OR (? IS NULL AND result.run_id IS NULL))
           GROUP BY r.id ORDER BY r.code`,
        )
        .all(runId ?? null, runId ?? null) as Array<
        RuleRow & { issue_count: number }
      >
    ).map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      ruleType: row.rule_type,
      severity: row.severity,
      enabled: Boolean(row.enabled),
      issueCount: Number(row.issue_count),
      config: normalizeConfig(row.code, parseConfig(row.config_json)),
    }));
  }

  listResults(): QualityResultDto[] {
    const runId = this.currentRunId();
    return this.db
      .prepare(
        `SELECT result.id, result.rule_id AS ruleId, rule.code AS ruleCode, rule.name AS ruleName,
      result.object_type AS objectType, result.object_id AS objectId,
      COALESCE(table_object.name, column_object.name, result.object_id) AS objectName,
      result.severity, result.message, result.status, result.resolution_note AS resolutionNote,
      result.resolved_at AS resolvedAt, result.resolved_by AS resolvedBy, result.created_at AS createdAt
      FROM rule_results result JOIN quality_rules rule ON rule.id = result.rule_id
      LEFT JOIN meta_tables table_object ON result.object_type = 'table' AND table_object.id = result.object_id
      LEFT JOIN meta_columns column_object ON result.object_type = 'column' AND column_object.id = result.object_id
      WHERE (result.run_id=? OR (? IS NULL AND result.run_id IS NULL))
      ORDER BY result.created_at DESC, rule.code, objectName`,
      )
      .all(runId ?? null, runId ?? null) as unknown as QualityResultDto[];
  }
  listResultPage(
    query: QualityResultQuery = {},
    selectedRunId: string | null | undefined = this.currentRunId(),
  ): QualityResultPageDto {
    const page = Math.max(1, Math.trunc(query.page ?? 1)),
      pageSize = Math.min(100, Math.max(10, Math.trunc(query.pageSize ?? 20))),
      search = (query.search ?? "").trim(),
      severity = (query.severity ?? "").trim(),
      status = (query.status ?? "").trim(),
      tableId = (query.tableId ?? "").trim();
    const conditions: string[] = [
        "(result.run_id=? OR (? IS NULL AND result.run_id IS NULL))",
      ],
      params: Array<string | null> = [
        selectedRunId ?? null,
        selectedRunId ?? null,
      ];
    if (search) {
      conditions.push(
        "(rule.code LIKE ? OR rule.name LIKE ? OR result.message LIKE ? OR table_object.name LIKE ? OR column_object.name LIKE ?)",
      );
      const value = `%${search}%`;
      params.push(value, value, value, value, value);
    }
    if (severity) {
      conditions.push("result.severity=?");
      params.push(severity);
    }
    if (status) {
      conditions.push("result.status=?");
      params.push(status);
    }
    if (tableId) {
      conditions.push(
        "(result.object_type='table' AND result.object_id=? OR result.object_type='column' AND column_object.table_id=?)",
      );
      params.push(tableId, tableId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const from = `FROM rule_results result JOIN quality_rules rule ON rule.id=result.rule_id LEFT JOIN meta_tables table_object ON result.object_type='table' AND table_object.id=result.object_id LEFT JOIN meta_columns column_object ON result.object_type='column' AND column_object.id=result.object_id ${where}`;
    const total = Number(
      (
        this.db.prepare(`SELECT COUNT(*) total ${from}`).get(...params) as {
          total: number;
        }
      ).total,
    );
    const items = this.db
      .prepare(
        `SELECT result.id,result.rule_id ruleId,rule.code ruleCode,rule.name ruleName,result.object_type objectType,result.object_id objectId,COALESCE(table_object.name,column_object.name,result.object_id) objectName,result.severity,result.message,result.status,result.resolution_note resolutionNote,result.resolved_at resolvedAt,result.resolved_by resolvedBy,result.created_at createdAt ${from} ORDER BY result.created_at DESC,rule.code,objectName LIMIT ? OFFSET ?`,
      )
      .all(
        ...params,
        pageSize,
        (page - 1) * pageSize,
      ) as unknown as QualityResultDto[];
    const lastRunAt = (
      this.db
        .prepare(
          "SELECT MAX(finished_at) value FROM rule_runs WHERE status='completed'",
        )
        .get() as { value: string | null }
    ).value;
    const metadataRevision = readRevision(this.db, "metadata.revision") ?? 0;
    const qualityRevision = readRevision(this.db, "quality.lastRevision");
    const hasMetadata = Boolean(
      this.db.prepare("SELECT 1 FROM meta_tables LIMIT 1").get(),
    );
    return {
      items,
      total,
      page,
      pageSize,
      lastRunAt,
      stale: hasMetadata && qualityRevision !== metadataRevision,
    };
  }

  updateResult(
    id: string,
    input: UpdateQualityResultInput,
    actorUserId: string | null,
  ): QualityResultDto {
    if (!(["open", "resolved", "ignored"] as const).includes(input.status))
      throw new Error("Quality result status is invalid");
    const note = (input.resolutionNote ?? "").trim();
    if (note.length > 1000)
      throw new Error("Resolution note cannot exceed 1000 characters");
    if (input.status !== "open" && !note)
      throw new Error("Resolution note is required");
    const result = this.db
      .prepare(
        "UPDATE rule_results SET status=?,resolution_note=?,resolved_at=?,resolved_by=? WHERE id=?",
      )
      .run(
        input.status,
        input.status === "open" ? null : note,
        input.status === "open" ? null : new Date().toISOString(),
        input.status === "open" ? null : actorUserId,
        id,
      );
    if (!result.changes) throw new Error("Quality result not found");
    const row = this.db
      .prepare(
        `SELECT result.id,result.rule_id ruleId,rule.code ruleCode,rule.name ruleName,
         result.object_type objectType,result.object_id objectId,
         COALESCE(table_object.name,column_object.name,result.object_id) objectName,
         result.severity,result.message,result.status,result.resolution_note resolutionNote,
         result.resolved_at resolvedAt,result.resolved_by resolvedBy,result.created_at createdAt
         FROM rule_results result JOIN quality_rules rule ON rule.id=result.rule_id
         LEFT JOIN meta_tables table_object ON result.object_type='table' AND table_object.id=result.object_id
         LEFT JOIN meta_columns column_object ON result.object_type='column' AND column_object.id=result.object_id
         WHERE result.id=?`,
      )
      .get(id) as unknown as QualityResultDto;
    return row;
  }

  setRuleEnabled(id: string, enabled: boolean): QualityRuleDto {
    const current = this.listRules().find((rule) => rule.id === id);
    if (!current) throw new Error("Quality rule not found");
    return this.updateRule(id, {
      enabled,
      severity: current.severity,
      config: current.config,
    });
  }

  updateRule(id: string, input: UpdateQualityRuleInput): QualityRuleDto {
    if (
      this.db
        .prepare("SELECT 1 FROM rule_runs WHERE status='running' LIMIT 1")
        .get()
    )
      throw new Error(
        "Quality rules cannot be modified while checks are running",
      );
    this.db.exec("BEGIN");
    try {
      const rule = this.db
        .prepare("SELECT code FROM quality_rules WHERE id=?")
        .get(id) as { code: string } | undefined;
      if (!rule) throw new Error("Quality rule not found");
      if (!(["info", "warning", "error"] as const).includes(input.severity))
        throw new Error("Quality rule severity is invalid");
      const config = normalizeConfig(rule.code, input.config ?? {});
      const result = this.db
        .prepare(
          "UPDATE quality_rules SET enabled=?,severity=?,config_json=? WHERE id=?",
        )
        .run(input.enabled ? 1 : 0, input.severity, JSON.stringify(config), id);
      if (!result.changes) throw new Error("Quality rule not found");
      this.db.prepare("DELETE FROM rule_results WHERE rule_id=?").run(id);
      writeRevision(this.db, "quality.lastRevision", -1);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listRules().find((rule) => rule.id === id)!;
  }

  run(runId: string | null = null): QualityRunSummaryDto {
    const metadataRevision = readRevision(this.db, "metadata.revision") ?? 0;
    const rules = this.db
      .prepare("SELECT * FROM quality_rules WHERE enabled = 1 ORDER BY code")
      .all() as unknown as RuleRow[];
    const tables = this.db
      .prepare("SELECT * FROM meta_tables WHERE retired = 0")
      .all() as Array<Record<string, unknown>>;
    const columns = this.db
      .prepare("SELECT * FROM meta_columns")
      .all() as Array<Record<string, unknown>>;
    const primaryKeyTables = new Set(
      columns
        .filter((column) => Number(column.primary_key_ordinal) > 0)
        .map((column) => String(column.table_id)),
    );
    const findings: Array<{
      rule: RuleRow;
      objectType: string;
      objectId: string;
      message: string;
    }> = [];
    const add = (
      rule: RuleRow,
      objectType: string,
      objectId: unknown,
      message: string,
    ) =>
      findings.push({ rule, objectType, objectId: String(objectId), message });
    for (const rule of rules) {
      const config = normalizeConfig(rule.code, parseConfig(rule.config_json));
      if (rule.code === "table-primary-key")
        for (const table of tables)
          if (!primaryKeyTables.has(String(table.id)))
            add(
              rule,
              "table",
              table.id,
              "Table does not define a primary key.",
            );
      if (rule.code === "table-comment")
        for (const table of tables)
          if (!String(table.comment ?? "").trim())
            add(rule, "table", table.id, "Table comment is missing.");
      if (rule.code === "column-comment")
        for (const column of columns)
          if (!String(column.comment ?? "").trim())
            add(rule, "column", column.id, "Column comment is missing.");
      if (rule.code === "column-type")
        for (const column of columns)
          if (
            !String(column.normalized_type ?? "").trim() ||
            column.normalized_type === "unknown"
          )
            add(
              rule,
              "column",
              column.id,
              "Column type could not be normalized.",
            );
      if (rule.code === "column-required")
        for (const column of columns)
          if (
            ((config.identifierNames ?? DEFAULT_IDENTIFIER_NAMES).includes(
              String(column.name).toLowerCase(),
            ) ||
              (config.identifierSuffixes ?? DEFAULT_IDENTIFIER_SUFFIXES).some(
                (suffix) => String(column.name).toLowerCase().endsWith(suffix),
              )) &&
            Number(column.nullable) === 1
          )
            add(
              rule,
              "column",
              column.id,
              "Identifier column should be required.",
            );
      if (rule.code === "object-naming") {
        const pattern = new RegExp(
          config.namingPattern ?? DEFAULT_NAMING_PATTERN,
        );
        for (const table of tables)
          if (!pattern.test(String(table.name)))
            add(
              rule,
              "table",
              table.id,
              "Table name does not follow the naming convention.",
            );
        for (const column of columns)
          if (!pattern.test(String(column.name)))
            add(
              rule,
              "column",
              column.id,
              "Column name does not follow the naming convention.",
            );
      }
      if (rule.code === "relation-integrity") {
        const relations = this.db
          .prepare(
            "SELECT relation.*,COUNT(mapping.relation_id) mapping_count FROM table_relations relation LEFT JOIN relation_columns mapping ON mapping.relation_id=relation.id GROUP BY relation.id",
          )
          .all() as Array<Record<string, unknown>>;
        const incompatibleMappings = new Set(
          (
            this.db
              .prepare(
                `SELECT mapping.relation_id relationId
                 FROM relation_columns mapping
                 JOIN meta_columns source_column ON source_column.id=mapping.source_column_id
                 JOIN meta_columns target_column ON target_column.id=mapping.target_column_id
                 WHERE source_column.normalized_type<>target_column.normalized_type`,
              )
              .all() as Array<{ relationId: string }>
          ).map((mapping) => mapping.relationId),
        );
        for (const relation of relations) {
          if (
            !relation.source_table_id ||
            !relation.target_table_id ||
            relation.source_table_id === relation.target_table_id
          )
            add(
              rule,
              "relation",
              relation.id,
              "Relationship endpoints are incomplete or invalid.",
            );
          else if (
            relation.status === "confirmed" &&
            Number(relation.mapping_count) === 0
          )
            add(
              rule,
              "relation",
              relation.id,
              "Confirmed relationship does not define a field mapping.",
            );
          else if (incompatibleMappings.has(String(relation.id)))
            add(
              rule,
              "relation",
              relation.id,
              "Relationship maps fields with incompatible normalized types.",
            );
        }
      }
    }
    const now = new Date().toISOString();
    const insert = this.db.prepare(
      "INSERT INTO rule_results(id,rule_id,object_type,object_id,severity,message,created_at,run_id) VALUES(?,?,?,?,?,?,?,?)",
    );
    this.db.exec("BEGIN");
    try {
      if (runId)
        this.db.prepare("DELETE FROM rule_results WHERE run_id=?").run(runId);
      else this.db.exec("DELETE FROM rule_results WHERE run_id IS NULL");
      for (const finding of findings)
        insert.run(
          randomUUID(),
          finding.rule.id,
          finding.objectType,
          finding.objectId,
          finding.rule.severity,
          finding.message,
          now,
          runId,
        );
      writeRevision(this.db, "quality.lastRevision", metadataRevision);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    const page = this.listResultPage({ page: 1, pageSize: 100 }, runId);
    return {
      checkedRules: rules.length,
      checkedObjects: tables.length + columns.length,
      issues: page.total,
      results: page.items,
    };
  }
}
