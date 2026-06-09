# Review: Top 4 Issues

Issues are prioritized by business impact, with the task-update authorization bug first because it allows users without edit permission to change project data.

## 1. Task updates miss project membership and role authorization

- **File and line:** `src/app/api/tasks/[id]/route.ts:26`
- **Category:** Security
- **Severity:** Critical

`PATCH /api/tasks/[id]` authenticated the caller and checked that the task existed, but it updated the task without checking whether the caller belonged to that task's project or had an editable role. This was inconsistent with `DELETE /api/tasks/[id]`, which already checked `getProjectMembership` and `canEditTasks`, and it allowed unauthorized task edits in the vulnerable implementation.

**Recommended fix:** After loading `existing`, call `getProjectMembership(user.id, existing.projectId)` and reject non-members or viewers before `prisma.task.update`. This fix has been applied, and route tests now cover member update success, viewer rejection, and non-member rejection.

**Bug before and fix after:**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev@example.com","password":"password123"}' \
  | node -pe 'JSON.parse(fs.readFileSync(0, "utf8")).token')

PROJECT_ID=$(curl -s http://localhost:3000/api/projects \
  -H "Authorization: Bearer $TOKEN" \
  | node -pe 'JSON.parse(fs.readFileSync(0, "utf8")).projects.find((p) => p.name === "Q3 Launch").id')

TASK_ID=$(curl -s "http://localhost:3000/api/projects/$PROJECT_ID/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  | node -pe 'JSON.parse(fs.readFileSync(0, "utf8")).tasks[0].id')

curl -s -i -X PATCH "http://localhost:3000/api/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"viewer should not be able to update this"}'
```

Before the fix, the vulnerable route returned success:

```http
HTTP/1.1 200 OK
content-type: application/json

{"task":{"id":"...","title":"viewer should not be able to update this", ...}}
```

After the fix, the same curl is rejected:

```http
HTTP/1.1 403 Forbidden
content-type: application/json

{"error":"viewers cannot update tasks"}
```

## 2. Password hashes are exposed in project detail responses

- **File and line:** `src/app/api/projects/[id]/route.ts:25`
- **Category:** Security
- **Severity:** Critical

The project detail endpoint uses broad Prisma includes (`owner: true`, `memberships.include.user: true`, `tasks.include.assignee: true`, and `tasks.include.createdBy: true`) that return complete user records, including `passwordHash`. Any project member, including a viewer, can fetch the project detail response and receive bcrypt hashes for the owner, members, assignees, and task creators.

**Recommended fix:** Replace all broad user includes with explicit `select` blocks that only return safe fields such as `id`, `name`, and `email`. Add an API regression test asserting that `passwordHash` never appears in project detail responses.

**Bug reproduction:**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev@example.com","password":"password123"}' \
  | node -pe 'JSON.parse(fs.readFileSync(0, "utf8")).token')

curl -s http://localhost:3000/api/projects/cmq6l4pbm0006x79mq6jur1tq \
  -H "Authorization: Bearer $TOKEN"
```

Response excerpt:

```json
{
  "project": {
    "owner": {
      "email": "meera@taskboard.dev",
      "name": "Meera Iyer",
      "passwordHash": "$2a$10$UFb5ZBAc..."
    },
    "memberships": [
      {
        "role": "viewer",
        "user": {
          "email": "dev@example.com",
          "name": "Dev Sharma",
          "passwordHash": "$2a$10$UFb5ZBAc..."
        }
      }
    ]
  }
}
```

## 3. Task search builds raw SQL with user input

- **File and line:** `src/app/api/projects/[id]/tasks/route.ts:27`
- **Category:** Security
- **Severity:** High

The task search path interpolates `projectId` and `q` directly into a SQL string and executes it with `prisma.$queryRawUnsafe`. A crafted `q` value can alter the SQL predicate, leak data, or break the endpoint depending on the database response.

**Recommended fix:** Use Prisma's structured query API with `contains`/`mode: "insensitive"` for title and description search. If raw SQL is required, use parameterized `$queryRaw` instead of `$queryRawUnsafe`.

## 4. User email uniqueness is only enforced in application code

- **File and line:** `prisma/schema.prisma:25`
- **Category:** Data Integrity
- **Severity:** Medium

The `User.email` field is not marked unique in the Prisma schema, while registration only performs a pre-insert `findFirst` check. Two concurrent registration requests with the same email can pass the application check before either insert commits, creating duplicate login identities.

**Recommended fix:** Add `@unique` to `User.email`, create a Prisma migration for the unique index, and handle unique-constraint errors in `POST /api/auth/register` by returning the existing "account already exists" response. Add a registration test that verifies duplicate email handling.
