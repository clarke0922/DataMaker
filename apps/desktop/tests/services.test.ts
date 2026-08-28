import { describe, expect, it, vi } from "vitest";
import { ApplicationServices, classifyError } from "../src/main/services.js";

describe("ApplicationServices mutation auditing", () => {
  it("classifies actionable errors and retryability consistently", () => {
    expect(classifyError("Data source file does not exist")).toMatchObject({
      category: "SOURCE",
      code: "SOURCE_ERROR",
      retryable: true,
    });
    expect(classifyError("SQL parser failed near line 4")).toMatchObject({
      category: "PARSER",
      code: "PARSE_ERROR",
      retryable: false,
    });
    expect(classifyError("Schema migration 6 checksum mismatch")).toMatchObject(
      {
        category: "DATABASE",
        retryable: true,
      },
    );
    expect(classifyError("Unexpected worker protocol response")).toMatchObject({
      category: "INTERNAL",
      retryable: true,
    });
    expect(classifyError("Query name and text are required")).toMatchObject({
      category: "VALIDATION",
      retryable: false,
    });
  });

  it("records a failed write with its diagnostic message", () => {
    const metadata = {
      removeRelation: vi.fn(() => {
        throw new Error("Physical relations cannot be deleted");
      }),
    };
    const audit = {
      record: vi.fn(),
      actorUserId: () => "user",
    };
    const services = new ApplicationServices(
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      metadata as never,
      audit as never,
      null as never,
      null as never,
      null as never,
      null as never,
      () => null as never,
    );
    const result = services.metadataRemoveRelation("physical");
    expect(result).toMatchObject({
      ok: false,
      error: {
        category: "CONFLICT",
        message: "Physical relations cannot be deleted",
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      "relation.delete",
      "relation",
      "physical",
      "failure",
      { error: "Physical relations cannot be deleted" },
    );
  });

  it("records failed asynchronous task cancellation", async () => {
    const audit = {
      record: vi.fn(),
      actorUserId: () => "user",
    };
    const qualityTasks = {
      cancel: vi.fn(async () => {
        throw new Error("Task is no longer running");
      }),
    };
    const services = new ApplicationServices(
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      audit as never,
      null as never,
      null as never,
      qualityTasks as never,
      null as never,
      () => null as never,
    );

    const result = await services.qualityCancelTask("quality-1");

    expect(result).toMatchObject({
      ok: false,
      error: { category: "CONFLICT", message: "Task is no longer running" },
    });
    expect(audit.record).toHaveBeenCalledWith(
      "quality.run.cancel",
      "quality_task",
      "quality-1",
      "failure",
      { error: "Task is no longer running" },
    );
  });
});
