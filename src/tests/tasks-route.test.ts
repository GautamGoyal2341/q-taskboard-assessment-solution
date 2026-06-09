import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/tasks/[id]/route";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, getProjectMembership } from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    getProjectMembership: vi.fn(),
  };
});

const taskFindUnique = vi.mocked(prisma.task.findUnique);
const taskUpdate = vi.mocked(prisma.task.update);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);
const mockedGetProjectMembership = vi.mocked(getProjectMembership);

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/tasks/task_1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("PATCH /api/tasks/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCurrentUser.mockResolvedValue({
      id: "user_1",
      email: "user@example.com",
      name: "User",
    });
    taskFindUnique.mockResolvedValue({
      id: "task_1",
      projectId: "project_1",
      title: "Existing task",
      description: null,
      status: "todo",
      assigneeId: null,
      createdById: "creator_1",
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("rejects viewers before updating a task", async () => {
    mockedGetProjectMembership.mockResolvedValue({ role: "viewer" });

    const res = await PATCH(patchRequest({ title: "Changed" }), {
      params: Promise.resolve({ id: "task_1" }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "viewers cannot update tasks" });
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  it("rejects users who are not project members before updating a task", async () => {
    mockedGetProjectMembership.mockResolvedValue(null);

    const res = await PATCH(patchRequest({ title: "Changed" }), {
      params: Promise.resolve({ id: "task_1" }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "you are not a member of this project",
    });
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  it("allows project members to update a task", async () => {
    mockedGetProjectMembership.mockResolvedValue({ role: "member" });
    taskUpdate.mockResolvedValue({
      id: "task_1",
      projectId: "project_1",
      title: "Changed",
      description: null,
      status: "todo",
      assigneeId: null,
      createdById: "creator_1",
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      assignee: null,
    } as never);

    const res = await PATCH(patchRequest({ title: "Changed" }), {
      params: Promise.resolve({ id: "task_1" }),
    });

    expect(res.status).toBe(200);
    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "task_1" },
        data: { title: "Changed" },
      }),
    );
  });
});
