import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, PATCH, POST } from "@/app/api/tasks/[id]/comments/route";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, getProjectMembership } from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
    },
    comment: {
      findMany: vi.fn(),
      create: vi.fn(),
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
const commentFindMany = vi.mocked(prisma.comment.findMany);
const commentCreate = vi.mocked(prisma.comment.create);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);
const mockedGetProjectMembership = vi.mocked(getProjectMembership);

function request(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/tasks/task_1/comments", {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json" },
  });
}

const params = { params: Promise.resolve({ id: "task_1" }) };

describe("/api/tasks/[id]/comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCurrentUser.mockResolvedValue({
      id: "user_1",
      email: "user@example.com",
      name: "User",
    });
    taskFindUnique.mockResolvedValue({ projectId: "project_1" } as never);
  });

  it("lists comments chronologically for project viewers", async () => {
    mockedGetProjectMembership.mockResolvedValue({ role: "viewer" });
    commentFindMany.mockResolvedValue([
      {
        id: "comment_1",
        taskId: "task_1",
        authorId: "user_1",
        body: "First",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        author: { id: "user_1", name: "User", email: "user@example.com" },
      },
      {
        id: "comment_2",
        taskId: "task_1",
        authorId: "user_2",
        body: "Second",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        author: { id: "user_2", name: "Other", email: "other@example.com" },
      },
    ] as never);

    const res = await GET(request("GET"), params);

    expect(res.status).toBe(200);
    expect(commentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: "task_1" },
        orderBy: { createdAt: "asc" },
      }),
    );
    const data = await res.json();
    expect(data.comments.map((comment: { body: string }) => comment.body)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("rejects unauthenticated comment reads", async () => {
    mockedGetCurrentUser.mockResolvedValue(null);

    const res = await GET(request("GET"), params);

    expect(res.status).toBe(401);
    expect(commentFindMany).not.toHaveBeenCalled();
  });

  it("rejects comment reads for users outside the project", async () => {
    mockedGetProjectMembership.mockResolvedValue(null);

    const res = await GET(request("GET"), params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "you are not a member of this project",
    });
    expect(commentFindMany).not.toHaveBeenCalled();
  });

  it("allows project members to post comments", async () => {
    mockedGetProjectMembership.mockResolvedValue({ role: "member" });
    commentCreate.mockResolvedValue({
      id: "comment_1",
      taskId: "task_1",
      authorId: "user_1",
      body: "Looks good",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      author: { id: "user_1", name: "User", email: "user@example.com" },
    } as never);

    const res = await POST(request("POST", { body: "Looks good" }), params);

    expect(res.status).toBe(201);
    expect(commentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          taskId: "task_1",
          authorId: "user_1",
          body: "Looks good",
        },
      }),
    );
  });

  it("allows project admins to post comments", async () => {
    mockedGetProjectMembership.mockResolvedValue({ role: "admin" });
    commentCreate.mockResolvedValue({
      id: "comment_1",
      taskId: "task_1",
      authorId: "user_1",
      body: "Admin note",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      author: { id: "user_1", name: "User", email: "user@example.com" },
    } as never);

    const res = await POST(request("POST", { body: "Admin note" }), params);

    expect(res.status).toBe(201);
    expect(commentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ body: "Admin note" }),
      }),
    );
  });

  it("rejects unauthenticated comment posts", async () => {
    mockedGetCurrentUser.mockResolvedValue(null);

    const res = await POST(request("POST", { body: "Nope" }), params);

    expect(res.status).toBe(401);
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it("rejects comment posts for users outside the project", async () => {
    mockedGetProjectMembership.mockResolvedValue(null);

    const res = await POST(request("POST", { body: "Nope" }), params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "you are not a member of this project",
    });
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it("rejects viewers when posting comments", async () => {
    mockedGetProjectMembership.mockResolvedValue({ role: "viewer" });

    const res = await POST(request("POST", { body: "I should not post" }), params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "viewers cannot post comments",
    });
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it("does not allow comments to be edited", async () => {
    const res = await PATCH();

    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, POST");
    await expect(res.json()).resolves.toEqual({ error: "method not allowed" });
  });

  it("does not allow comments to be deleted", async () => {
    const res = await DELETE();

    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, POST");
    await expect(res.json()).resolves.toEqual({ error: "method not allowed" });
  });
});
