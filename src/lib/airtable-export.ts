import Airtable from "airtable";
import type { TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const AIRTABLE_TASK_ID_FIELD = "Task ID";
const DEFAULT_AIRTABLE_NAME_FIELD = "Name";
const DEFAULT_AIRTABLE_DESCRIPTION_FIELD = "description";
const DEFAULT_AIRTABLE_STATUS_FIELD = "Status";

type TaskForExport = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeId: string | null;
  createdById: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  project: { name: string };
  assignee: { name: string; email: string } | null;
  createdBy: { name: string; email: string };
};

type AirtableFields = Record<string, string | number | null>;

type AirtableRecordLike = {
  id: string;
  fields: Record<string, unknown>;
};

export type AirtableTableLike = {
  select: (params?: Record<string, unknown>) => {
    all: () => Promise<AirtableRecordLike[]>;
  };
  create: (
    fields: AirtableFields,
    opts?: { typecast?: boolean },
  ) => Promise<AirtableRecordLike>;
  update: (
    recordId: string,
    fields: AirtableFields,
    opts?: { typecast?: boolean },
  ) => Promise<AirtableRecordLike>;
};

export type AirtableExportFailure = {
  taskId?: string;
  title?: string;
  operation: "fetch_existing" | "create" | "update";
  error: string;
  transient: boolean;
};

export type AirtableExportResult = {
  total: number;
  created: number;
  updated: number;
  failed: number;
  failures: AirtableExportFailure[];
};

export class AirtableConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AirtableConfigError";
  }
}

function getAirtableFieldConfig() {
  return {
    taskId: process.env.AIRTABLE_TASK_ID_FIELD || AIRTABLE_TASK_ID_FIELD,
    name: process.env.AIRTABLE_NAME_FIELD || DEFAULT_AIRTABLE_NAME_FIELD,
    description:
      process.env.AIRTABLE_DESCRIPTION_FIELD || DEFAULT_AIRTABLE_DESCRIPTION_FIELD,
    status: process.env.AIRTABLE_STATUS_FIELD || DEFAULT_AIRTABLE_STATUS_FIELD,
  };
}

export function getAirtableTasksTable(): AirtableTableLike {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME;

  if (!apiKey || !baseId || !tableName) {
    throw new AirtableConfigError(
      "Airtable export is not configured. Set AIRTABLE_API_KEY, AIRTABLE_BASE_ID, and AIRTABLE_TABLE_NAME.",
    );
  }

  return new Airtable({ apiKey }).base(baseId)(
    tableName,
  ) as unknown as AirtableTableLike;
}

export async function exportProjectTasksToAirtable(
  projectId: string,
  table: AirtableTableLike = getAirtableTasksTable(),
): Promise<AirtableExportResult> {
  const tasks = await prisma.task.findMany({
    where: { projectId },
    include: {
      project: { select: { name: true } },
      assignee: { select: { name: true, email: true } },
      createdBy: { select: { name: true, email: true } },
    },
    orderBy: [{ status: "asc" }, { position: "asc" }],
  });

  const result: AirtableExportResult = {
    total: tasks.length,
    created: 0,
    updated: 0,
    failed: 0,
    failures: [],
  };

  let existingRecords: Map<string, AirtableRecordLike>;
  try {
    existingRecords = await fetchExistingRecords(table);
  } catch (error) {
    result.failed = tasks.length;
    result.failures.push({
      operation: "fetch_existing",
      error: errorMessage(error),
      transient: isTransientAirtableError(error),
    });
    return result;
  }

  for (const task of tasks) {
    const fields = taskToAirtableFields(task);
    const existing =
      existingRecords.get(task.id) ?? existingRecords.get(task.title.trim());
    const operation = existing ? "update" : "create";

    try {
      if (existing) {
        await withRetry(() =>
          table.update(existing.id, fields, { typecast: true }),
        );
        result.updated += 1;
      } else {
        const created = await withRetry(() =>
          table.create(fields, { typecast: true }),
        );
        existingRecords.set(task.id, created);
        existingRecords.set(task.title.trim(), created);
        result.created += 1;
      }
    } catch (error) {
      result.failed += 1;
      result.failures.push({
        taskId: task.id,
        title: task.title,
        operation,
        error: errorMessage(error),
        transient: isTransientAirtableError(error),
      });
    }
  }

  return result;
}

async function fetchExistingRecords(
  table: AirtableTableLike,
): Promise<Map<string, AirtableRecordLike>> {
  const fields = getAirtableFieldConfig();
  const records = await withRetry(() =>
    table.select().all(),
  );

  const existing = new Map<string, AirtableRecordLike>();
  for (const record of records) {
    const taskId = record.fields[fields.taskId];
    const name = record.fields[fields.name];
    if (typeof taskId === "string") existing.set(taskId, record);
    if (typeof name === "string") existing.set(name.trim(), record);
  }
  return existing;
}

function taskToAirtableFields(task: TaskForExport): AirtableFields {
  const fields = getAirtableFieldConfig();
  return {
    [fields.taskId]: task.id,
    [fields.name]: task.title,
    [fields.description]: task.description ?? "",
    [fields.status]: task.status,
  };
}

async function withRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientAirtableError(error) || attempt === attempts) break;
      await sleep(200 * attempt);
    }
  }

  throw lastError;
}

function isTransientAirtableError(error: unknown): boolean {
  const err = error as {
    statusCode?: number;
    status?: number;
    code?: string;
    type?: string;
  };
  const status = err.statusCode ?? err.status;
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  if (err.type === "rate-limit" || err.type === "network") return true;
  return ["ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"].includes(
    err.code ?? "",
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown Airtable error";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
