import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/projects/[id]/export/airtable/route";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, getProjectMembership } from "@/lib/auth";
import { exportProjectTasksToAirtable } from "@/lib/airtable-export";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    getProjectMembership: vi.fn(),
  };
});

vi.mock("@/lib/airtable-export", () => ({
  AirtableConfigError: class AirtableConfigError extends Error {},
  exportProjectTasksToAirtable: vi.fn(),
}));

const projectFindUnique = vi.mocked(prisma.project.findUnique);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);
const mockedGetProjectMembership = vi.mocked(getProjectMembership);
const mockedExportProjectTasksToAirtable = vi.mocked(
  exportProjectTasksToAirtable,
);

const params = { params: Promise.resolve({ id: "project_1" }) };

function request() {
  return new NextRequest(
    "http://localhost/api/projects/project_1/export/airtable",
    {
      method: "POST",
    },
  );
}

describe("POST /api/projects/[id]/export/airtable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCurrentUser.mockResolvedValue({
      id: "user_1",
      email: "user@example.com",
      name: "User",
    });
    projectFindUnique.mockResolvedValue({ id: "project_1" } as never);
    mockedExportProjectTasksToAirtable.mockResolvedValue({
      total: 2,
      created: 1,
      updated: 1,
      failed: 0,
      failures: [],
    });
  });

  it("rejects unauthenticated users", async () => {
    mockedGetCurrentUser.mockResolvedValue(null);

    const res = await POST(request(), params);

    expect(res.status).toBe(401);
    expect(mockedExportProjectTasksToAirtable).not.toHaveBeenCalled();
  });

  it("rejects viewers", async () => {
    mockedGetProjectMembership.mockResolvedValue({ role: "viewer" });

    const res = await POST(request(), params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "viewers cannot export tasks",
    });
    expect(mockedExportProjectTasksToAirtable).not.toHaveBeenCalled();
  });

  it("allows project members to trigger export", async () => {
    mockedGetProjectMembership.mockResolvedValue({ role: "member" });

    const res = await POST(request(), params);

    expect(res.status).toBe(200);
    expect(mockedExportProjectTasksToAirtable).toHaveBeenCalledWith(
      "project_1",
    );
    await expect(res.json()).resolves.toEqual({
      export: {
        total: 2,
        created: 1,
        updated: 1,
        failed: 0,
        failures: [],
      },
    });
  });

  it("allows project admins to trigger export", async () => {
    mockedGetProjectMembership.mockResolvedValue({ role: "admin" });

    const res = await POST(request(), params);

    expect(res.status).toBe(200);
    expect(mockedExportProjectTasksToAirtable).toHaveBeenCalledWith(
      "project_1",
    );
  });
});
