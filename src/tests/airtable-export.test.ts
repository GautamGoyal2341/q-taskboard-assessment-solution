import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AIRTABLE_TASK_ID_FIELD,
  exportProjectTasksToAirtable,
  type AirtableTableLike,
} from "@/lib/airtable-export";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findMany: vi.fn(),
    },
  },
}));

const taskFindMany = vi.mocked(prisma.task.findMany);

const baseTask = {
  id: "task_1",
  projectId: "project_1",
  title: "Task one",
  description: "Details",
  status: "todo" as const,
  assigneeId: null,
  createdById: "user_1",
  position: 0,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  project: { name: "Project" },
  assignee: null,
  createdBy: { name: "User", email: "user@example.com" },
};

function fakeTable(
  existingRecords: Array<{ id: string; fields: Record<string, unknown> }> = [],
) {
  return {
    select: vi.fn(() => ({
      all: vi.fn().mockResolvedValue(existingRecords),
    })),
    create: vi.fn().mockResolvedValue({ id: "airtable_created", fields: {} }),
    update: vi.fn().mockResolvedValue({ id: "airtable_updated", fields: {} }),
  } satisfies AirtableTableLike;
}

describe("exportProjectTasksToAirtable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskFindMany.mockResolvedValue([baseTask] as never);
  });

  it("creates missing Airtable records", async () => {
    const table = fakeTable();

    const result = await exportProjectTasksToAirtable("project_1", table);

    expect(result).toMatchObject({
      total: 1,
      created: 1,
      updated: 0,
      failed: 0,
    });
    expect(table.create).toHaveBeenCalledWith(
      expect.objectContaining({
        [AIRTABLE_TASK_ID_FIELD]: "task_1",
        Name: "Task one",
        description: "Details",
        Status: "todo",
      }),
      { typecast: true },
    );
    expect(table.update).not.toHaveBeenCalled();
  });

  it("updates existing Airtable records by Task ID", async () => {
    const table = fakeTable([{ id: "rec_existing", fields: { Name: "Task one" } }]);

    const result = await exportProjectTasksToAirtable("project_1", table);

    expect(result).toMatchObject({
      total: 1,
      created: 0,
      updated: 1,
      failed: 0,
    });
    expect(table.update).toHaveBeenCalledWith(
      "rec_existing",
      expect.objectContaining({
        [AIRTABLE_TASK_ID_FIELD]: "task_1",
        Name: "Task one",
      }),
      { typecast: true },
    );
    expect(table.create).not.toHaveBeenCalled();
  });

  it("retries transient record failures", async () => {
    const table = fakeTable();
    const rateLimit = Object.assign(new Error("rate limited"), {
      statusCode: 429,
    });
    vi.mocked(table.create)
      .mockRejectedValueOnce(rateLimit)
      .mockResolvedValueOnce({ id: "airtable_created", fields: {} });

    const result = await exportProjectTasksToAirtable("project_1", table);

    expect(result).toMatchObject({ total: 1, created: 1, failed: 0 });
    expect(table.create).toHaveBeenCalledTimes(2);
  });

  it("continues when one record permanently fails", async () => {
    taskFindMany.mockResolvedValue([
      baseTask,
      { ...baseTask, id: "task_2", title: "Task two", position: 1 },
    ] as never);
    const table = fakeTable();
    vi.mocked(table.create)
      .mockRejectedValueOnce(
        Object.assign(new Error("bad field"), { statusCode: 422 }),
      )
      .mockResolvedValueOnce({ id: "airtable_created", fields: {} });

    const result = await exportProjectTasksToAirtable("project_1", table);

    expect(result).toMatchObject({
      total: 2,
      created: 1,
      updated: 0,
      failed: 1,
    });
    expect(result.failures).toEqual([
      expect.objectContaining({
        taskId: "task_1",
        operation: "create",
        transient: false,
      }),
    ]);
    expect(table.create).toHaveBeenCalledTimes(2);
  });
});
