import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  AuditLogDto,
  AuditLogPageDto,
  AuditLogQuery,
  AuditStatisticsQuery,
  AuditStatisticsRowDto,
} from "@datamaker/contracts";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

function sanitizeContext(value: unknown, key = ""): unknown {
  if (/password|token|secret|authorization/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => sanitizeContext(item));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([childKey, item]) => [childKey, sanitizeContext(item, childKey)]),
    );
  if (typeof value === "string") {
    const normalized = /path|file|backup/i.test(key)
      ? path.basename(value)
      : value;
    return normalized
      .replace(/[A-Za-z]:\\[^\s"'<>|]*/g, "[PATH]")
      .slice(0, 2000);
  }
  return value;
}

export class AuditRepository {
  private readonly actorContext = new AsyncLocalStorage<string>();
  private recordsSincePrune = 0;
  constructor(private readonly db: DatabaseSync) {
    this.prune();
  }
  private retentionDays() {
    try {
      const row = this.db
        .prepare(
          "SELECT value_json value FROM app_settings WHERE key='audit.retentionDays'",
        )
        .get() as { value: string } | undefined;
      const value = Number(row ? JSON.parse(row.value) : 180);
      return Number.isFinite(value) ? Math.min(3650, Math.max(1, value)) : 180;
    } catch {
      return 180;
    }
  }
  prune(retentionDays = this.retentionDays(), maxRecords = 100000) {
    const cutoff = new Date(
      Date.now() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000,
    ).toISOString();
    const expired = this.db
      .prepare("DELETE FROM audit_logs WHERE occurred_at < ?")
      .run(cutoff).changes;
    const overflow = this.db
      .prepare(
        "DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs ORDER BY occurred_at DESC,id DESC LIMIT -1 OFFSET ?)",
      )
      .run(Math.max(1, maxRecords)).changes;
    this.recordsSincePrune = 0;
    return Number(expired) + Number(overflow);
  }
  runAs<T>(actorUserId: string, operation: () => T): T {
    return this.actorContext.run(actorUserId, operation);
  }
  enterActor(actorUserId: string) {
    this.actorContext.enterWith(actorUserId);
  }
  actorUserId() {
    return this.actorContext.getStore() ?? null;
  }
  record(
    action: string,
    objectType: string | null,
    objectId: string | null,
    result: string,
    context: Record<string, unknown> = {},
  ) {
    const sanitized = sanitizeContext(context) as Record<string, unknown>;
    let serialized = JSON.stringify(sanitized);
    if (serialized.length > 8192)
      serialized = JSON.stringify({
        truncated: true,
        summary: serialized.slice(0, 8000),
      });
    this.db
      .prepare(
        "INSERT INTO audit_logs(id,actor_user_id,action,object_type,object_id,result,context_json,occurred_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        this.actorContext.getStore() ?? null,
        action,
        objectType,
        objectId,
        result,
        serialized,
        new Date().toISOString(),
      );
    this.recordsSincePrune++;
    if (this.recordsSincePrune >= 1000) this.prune();
  }
  list(query: AuditLogQuery = {}): AuditLogPageDto {
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const pageSize = Math.min(
      100,
      Math.max(10, Math.trunc(query.pageSize ?? 20)),
    );
    const search = (query.search ?? "").trim();
    const conditions: string[] = [];
    const params: string[] = [];
    if (search) {
      conditions.push(
        "(log.action LIKE ? OR log.object_type LIKE ? OR log.object_id LIKE ? OR user.username LIKE ? OR log.context_json LIKE ?)",
      );
      const value = `%${search}%`;
      params.push(value, value, value, value, value);
    }
    if (query.result) {
      conditions.push("log.result=?");
      params.push(query.result);
    }
    if (query.from) {
      conditions.push("log.occurred_at >= ?");
      params.push(query.from);
    }
    if (query.to) {
      conditions.push("log.occurred_at <= ?");
      params.push(query.to);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const from = `FROM audit_logs log LEFT JOIN users user ON user.id=log.actor_user_id ${where}`;
    const total = Number(
      (
        this.db.prepare(`SELECT COUNT(*) total ${from}`).get(...params) as {
          total: number;
        }
      ).total,
    );
    const items = this.db
      .prepare(
        `SELECT log.id,log.actor_user_id actorUserId,user.username actorUsername,log.action,log.object_type objectType,log.object_id objectId,log.result,log.context_json context,log.occurred_at occurredAt ${from} ORDER BY log.occurred_at DESC LIMIT ? OFFSET ?`,
      )
      .all(
        ...params,
        pageSize,
        (page - 1) * pageSize,
      ) as unknown as AuditLogDto[];
    return { items, total, page, pageSize };
  }

  statistics(query: AuditStatisticsQuery): AuditStatisticsRowDto[] {
    const conditions = ["log.result = 'success'"];
    const params: string[] = [];
    if (query.from) {
      conditions.push("log.occurred_at >= ?");
      params.push(query.from);
    }
    if (query.to) {
      conditions.push("log.occurred_at <= ?");
      params.push(query.to);
    }
    const group = query.groupBy === "user"
      ? "COALESCE(user.username, 'system')"
      : "COALESCE(log.object_type, 'system')";
    return this.db.prepare(`SELECT ${group} AS [group],
      SUM(CASE WHEN log.action LIKE '%.create%' OR log.action LIKE '%.initialize%' THEN 1 ELSE 0 END) created,
      SUM(CASE WHEN log.action LIKE '%.view%' OR log.action LIKE '%.read%' OR log.action LIKE '%.search%' THEN 1 ELSE 0 END) viewed,
      SUM(CASE WHEN log.action LIKE '%.update%' OR log.action LIKE '%.save%' OR log.action LIKE '%.toggle%' THEN 1 ELSE 0 END) updated,
      SUM(CASE WHEN log.action LIKE '%.delete%' OR log.action LIKE '%.remove%' THEN 1 ELSE 0 END) deleted,
      SUM(CASE WHEN log.action NOT LIKE '%.create%' AND log.action NOT LIKE '%.initialize%'
        AND log.action NOT LIKE '%.view%' AND log.action NOT LIKE '%.read%' AND log.action NOT LIKE '%.search%'
        AND log.action NOT LIKE '%.update%' AND log.action NOT LIKE '%.save%' AND log.action NOT LIKE '%.toggle%'
        AND log.action NOT LIKE '%.delete%' AND log.action NOT LIKE '%.remove%' THEN 1 ELSE 0 END) other,
      COUNT(*) total
      FROM audit_logs log LEFT JOIN users user ON user.id = log.actor_user_id
      WHERE ${conditions.join(" AND ")} GROUP BY ${group} ORDER BY total DESC, [group]`).all(...params) as unknown as AuditStatisticsRowDto[];
  }
}
