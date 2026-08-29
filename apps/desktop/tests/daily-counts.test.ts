import { describe, expect, it } from "vitest";
import type { ManagementRecordDto } from "@datamaker/contracts";
import { aggregateDailyCounts } from "../src/renderer/DailyCountsPage.js";

function record(
  id: string,
  tableName: string,
  date: string,
  increase: number,
  total: number,
): ManagementRecordDto {
  return {
    id,
    table_name: tableName,
    stat_date: date,
    daily_increase: increase,
    total_count: total,
  };
}

describe("daily count aggregation", () => {
  const records = [
    record("1", "ORDERS", "2026-08-24", 5, 10),
    record("2", "ORDERS", "2026-08-28", -2, 8),
    record("3", "USERS", "2026-08-28", 3, 20),
    record("4", "ORDERS", "2026-09-01", 7, 15),
  ];

  it("groups the selected week and keeps the latest cumulative total", () => {
    expect(aggregateDailyCounts(records, "week", "2026-08-28")).toEqual([
      {
        table_name: "ORDERS",
        daily_increase: 3,
        total_count: 8,
        records: 2,
        latest: "2026-08-28",
      },
      {
        table_name: "USERS",
        daily_increase: 3,
        total_count: 20,
        records: 1,
        latest: "2026-08-28",
      },
    ]);
  });

  it("filters a single day", () => {
    expect(aggregateDailyCounts(records, "day", "2026-09-01")).toEqual([
      {
        table_name: "ORDERS",
        daily_increase: 7,
        total_count: 15,
        records: 1,
        latest: "2026-09-01",
      },
    ]);
  });
});
