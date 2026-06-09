import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  canEditTasks,
  forbidden,
  getCurrentUser,
  getProjectMembership,
  methodNotAllowed,
  notFound,
  unauthorized,
} from "@/lib/auth";
import {
  AirtableConfigError,
  exportProjectTasksToAirtable,
} from "@/lib/airtable-export";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!project) return notFound("project not found");

  const membership = await getProjectMembership(user.id, id);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("viewers cannot export tasks");
  }

  try {
    const result = await exportProjectTasksToAirtable(id);
    return NextResponse.json({ export: result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Airtable export failed";
    const status = error instanceof AirtableConfigError ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET() {
  return methodNotAllowed(["POST"]);
}
