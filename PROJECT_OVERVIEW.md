# TaskBoard Project Overview

TaskBoard is a fullstack project-management app built with Next.js 15 App Router, React 19, TypeScript, Prisma, PostgreSQL, TanStack Query, Zod, bcrypt, and JWT authentication.

The app lets users register/login, view projects they belong to, open a kanban-style project board, create tasks, edit task details, assign members, move task status, and delete tasks.

## High-Level Structure

```text
.
├── src
│   ├── app
│   │   ├── api                 # Next.js route handlers / backend API
│   │   ├── dashboard           # Authenticated project list page
│   │   ├── login               # Login page
│   │   ├── projects/[id]       # Project board page
│   │   ├── register            # Register page
│   │   ├── globals.css         # Global Tailwind styles
│   │   ├── layout.tsx          # Root layout and QueryProvider
│   │   └── page.tsx            # Redirects to login or dashboard
│   ├── components              # Shared React UI components
│   ├── lib                     # Shared client/server helpers
│   ├── schemas                 # Zod validation schemas
│   ├── tests                   # Vitest tests
│   └── types                   # Shared TypeScript API/domain types
├── prisma
│   ├── migrations              # SQL migration history
│   ├── schema.prisma           # Prisma database schema
│   └── seed.ts                 # Demo seed data
├── bin                         # Setup and Docker entrypoint scripts
├── docker-compose.yml          # Local Postgres + web/test services
├── Dockerfile
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── vitest.config.ts
```

## Tech Stack

- **Frontend:** Next.js App Router, React 19, TypeScript, Tailwind CSS
- **Client data fetching:** TanStack Query
- **Backend/API:** Next.js route handlers in `src/app/api`
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Validation:** Zod
- **Authentication:** bcrypt password hashes and signed JWT bearer tokens
- **Testing:** Vitest, React Testing Library, jsdom
- **Local environment:** Docker Compose with PostgreSQL 16

## App Routes

### Page Routes

| Route | File | Purpose |
| --- | --- | --- |
| `/` | `src/app/page.tsx` | Client-side redirect. If a token exists in localStorage, redirects to `/dashboard`; otherwise redirects to `/login`. |
| `/login` | `src/app/login/page.tsx` | Login form. Calls `POST /api/auth/login`, stores token/user in localStorage, then redirects to dashboard. |
| `/register` | `src/app/register/page.tsx` | Registration form. Calls `POST /api/auth/register`, stores token/user, then redirects to dashboard. |
| `/dashboard` | `src/app/dashboard/page.tsx` | Authenticated project list. Calls `GET /api/projects`. |
| `/projects/[id]` | `src/app/projects/[id]/page.tsx` | Project board/detail page. Calls project and task APIs through React Query mutations. |

### API Routes

| Method | Route | File | Auth | Purpose |
| --- | --- | --- | --- | --- |
| `POST` | `/api/auth/register` | `src/app/api/auth/register/route.ts` | No | Creates a user, hashes password, returns JWT and user. |
| `POST` | `/api/auth/login` | `src/app/api/auth/login/route.ts` | No | Validates credentials, returns JWT and user. |
| `GET` | `/api/users/me` | `src/app/api/users/me/route.ts` | Yes | Returns the current authenticated user. |
| `GET` | `/api/projects` | `src/app/api/projects/route.ts` | Yes | Lists projects where current user has membership. |
| `POST` | `/api/projects` | `src/app/api/projects/route.ts` | Yes | Creates a project and makes creator an admin member. |
| `GET` | `/api/projects/[id]` | `src/app/api/projects/[id]/route.ts` | Yes + member | Returns project detail, owner, members, and tasks. |
| `PATCH` | `/api/projects/[id]` | `src/app/api/projects/[id]/route.ts` | Yes + admin | Updates project name/description. |
| `DELETE` | `/api/projects/[id]` | `src/app/api/projects/[id]/route.ts` | Yes + admin | Deletes project. Memberships/tasks cascade through DB relations. |
| `GET` | `/api/projects/[id]/tasks` | `src/app/api/projects/[id]/tasks/route.ts` | Yes + member | Lists project tasks. Supports `q` query search. |
| `POST` | `/api/projects/[id]/tasks` | `src/app/api/projects/[id]/tasks/route.ts` | Yes + admin/member | Creates a task at the end of the selected status column. |
| `PATCH` | `/api/tasks/[id]` | `src/app/api/tasks/[id]/route.ts` | Yes | Updates task fields. See implementation notes below. |
| `DELETE` | `/api/tasks/[id]` | `src/app/api/tasks/[id]/route.ts` | Yes + admin/member | Deletes a task after checking project membership and edit role. |

## Database Schema

Database schema is defined in `prisma/schema.prisma`. Tables are mapped to snake_case names in PostgreSQL.

### Enums

```text
Role:
- admin
- member
- viewer

TaskStatus:
- todo
- in_progress
- review
- done
```

### `users`

Represents application accounts.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `String` | Primary key, Prisma `cuid()` |
| `email` | `String` | Login email |
| `name` | `String` | Display name |
| `password_hash` | `String` | bcrypt hash |
| `created_at` | `DateTime` | Defaults to now |
| `updated_at` | `DateTime` | Auto-updated by Prisma |

Relations:
- One user can own many projects.
- One user can have many project memberships.
- One user can be assigned many tasks.
- One user can create many tasks.

### `projects`

Represents a project/workspace.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `String` | Primary key |
| `name` | `String` | Project name |
| `description` | `String?` | Optional description |
| `owner_id` | `String` | Required owner user id |
| `created_at` | `DateTime` | Defaults to now |
| `updated_at` | `DateTime` | Auto-updated |

Relations:
- Belongs to one owner user.
- Has many memberships.
- Has many tasks.
- Deleting a project cascades to memberships and tasks.

### `memberships`

Join table connecting users to projects with a project-specific role.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `String` | Primary key |
| `user_id` | `String` | User relation |
| `project_id` | `String` | Project relation |
| `role` | `Role` | Defaults to `member` |
| `created_at` | `DateTime` | Defaults to now |

Important constraints/indexes:
- Unique membership per user/project: `@@unique([userId, projectId])`
- Index on `projectId`
- User/project deletes cascade to memberships

### `tasks`

Represents project tasks shown on the board.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `String` | Primary key |
| `project_id` | `String` | Parent project |
| `title` | `String` | Required |
| `description` | `String?` | Optional |
| `status` | `TaskStatus` | Defaults to `todo` |
| `assignee_id` | `String?` | Optional assigned user |
| `created_by_id` | `String` | User who created task |
| `position` | `Int` | Ordering inside a column |
| `created_at` | `DateTime` | Defaults to now |
| `updated_at` | `DateTime` | Auto-updated |

Important constraints/indexes:
- Index on `[projectId, status]`
- Project delete cascades to tasks
- Assignee delete sets `assignee_id` to null
- Creator delete is restricted

## Authentication Flow

### Register

1. Browser submits name, email, and password to `POST /api/auth/register`.
2. Route validates input with `registerSchema`.
3. Route checks if the email already exists.
4. Password is hashed with `bcrypt.hash(password, 10)`.
5. User is inserted through Prisma.
6. JWT is signed with `{ userId, email }`.
7. API returns `{ user, token }`.
8. Client stores both values in localStorage through `setSession`.

### Login

1. Browser submits email and password to `POST /api/auth/login`.
2. Route validates input with `loginSchema`.
3. User is loaded by email.
4. Password is checked with `bcrypt.compare`.
5. JWT is signed with `{ userId, email }`.
6. API returns `{ user, token }`.
7. Client stores both values in localStorage and redirects to `/dashboard`.

### Authenticated Requests

Authenticated client requests use `apiFetch` in `src/lib/api-client.ts`.

Flow:

1. `apiFetch` reads `taskboard_token` from localStorage.
2. It sets `Content-Type: application/json`.
3. If a token exists, it sends `Authorization: Bearer <token>`.
4. Server routes call `getCurrentUser(req)`.
5. `getCurrentUser` reads the bearer token from request headers.
6. Token is verified with `verifyToken`.
7. User is loaded from the database by `payload.userId`.
8. If user/token is missing or invalid, routes return `401`.

JWT behavior:
- Signing and verification live in `src/lib/jwt.ts`.
- Token expiry is `30d`.
- `JWT_SECRET` is required at process startup.

Session storage:
- `taskboard_token` stores the JWT.
- `taskboard_user` stores a JSON copy of `{ id, email, name }`.
- Logout removes both localStorage keys.

## Authorization Model

Authorization is based on project membership and role.

Common helper functions live in `src/lib/auth.ts`:

| Function | Purpose |
| --- | --- |
| `getCurrentUser(req)` | Authenticates the bearer token and returns current user data. |
| `getProjectMembership(userId, projectId)` | Loads the user role for a project. |
| `canEditProject(role)` | Allows project edits only for `admin`. |
| `canEditTasks(role)` | Allows task edits for `admin` and `member`; denies `viewer`. |
| `unauthorized()` | Returns JSON `401`. |
| `forbidden()` | Returns JSON `403`. |
| `badRequest()` | Returns JSON `400`. |
| `notFound()` | Returns JSON `404`. |

Role behavior:

| Role | Project read | Project settings edit/delete | Task create/delete |
| --- | --- | --- | --- |
| `admin` | Yes | Yes | Yes |
| `member` | Yes | No | Yes |
| `viewer` | Yes | No | No |

## Request Processing Examples

### Load Dashboard Projects

1. User opens `/dashboard`.
2. Page checks for a localStorage token and redirects to `/login` if missing.
3. React Query calls `apiFetch("/api/projects")`.
4. `apiFetch` attaches JWT bearer token.
5. `GET /api/projects` calls `getCurrentUser`.
6. Prisma loads all memberships for the current user and includes each project, owner, and tasks.
7. API maps memberships into project summaries with role and task count.
8. Dashboard renders project cards.

### Load Project Board

1. User opens `/projects/[id]`.
2. React Query calls `GET /api/projects/[id]`.
3. API authenticates user.
4. API checks membership with `getProjectMembership`.
5. Prisma loads project owner, memberships with users, and tasks with assignee/creator.
6. Page groups tasks by status using `STATUS_ORDER`.
7. `StatusColumn` renders each status column, and `TaskCard` renders tasks.

### Create Task

1. User submits the "add a task" form on `/projects/[id]`.
2. React Query mutation posts to `POST /api/projects/[id]/tasks`.
3. API authenticates user.
4. API verifies user is a project member.
5. API verifies role with `canEditTasks`; viewers are rejected.
6. Request body is validated by `createTaskSchema`.
7. API finds the largest existing `position` in the selected status column.
8. New task is created with `position = last position + 1`.
9. React Query invalidates `["project", id]`, causing the project board to refresh.

### Update Task

1. User opens `TaskDetail` modal and edits title, description, status, or assignee.
2. React Query mutation sends `PATCH /api/tasks/[id]`.
3. API authenticates user.
4. API validates input with `updateTaskSchema`.
5. API checks that the task exists.
6. API updates the task with Prisma.
7. React Query invalidates project detail and closes the modal.

### Delete Task

1. User clicks "delete task" in `TaskDetail`.
2. React Query mutation sends `DELETE /api/tasks/[id]`.
3. API authenticates user.
4. API loads the task to find its `projectId`.
5. API verifies project membership.
6. API verifies role with `canEditTasks`.
7. Task is deleted.
8. React Query invalidates project detail and closes the modal.

## Core Logic

### Board Status Model

Statuses are centralized in `src/types/index.ts` and `src/schemas/task.ts`:

```text
todo -> in_progress -> review -> done
```

`STATUS_ORDER` controls the frontend column order. `STATUS_LABELS` controls display labels.

### Task Ordering

Task order uses an integer `position`.

When creating a new task:

1. The route looks for the highest `position` in the requested project/status column.
2. The new task receives `(last?.position ?? -1) + 1`.

Task updates can also patch `position`, but there is no full drag-and-drop reorder algorithm in the current UI.

### Validation

Input validation is done with Zod before database writes.

Auth schemas:
- `registerSchema`: email, password length >= 8, name required/max 80
- `loginSchema`: email and non-empty password

Project schemas:
- `updateProjectSchema`: optional name and nullable/optional description

Task schemas:
- `createTaskSchema`: required title, optional description/status/assignee
- `updateTaskSchema`: optional title, nullable description, optional status/assignee/position

### Data Fetching

Client data fetching uses TanStack Query.

`src/components/QueryProvider.tsx` creates a shared query client with:
- `staleTime: 30_000`
- `refetchOnWindowFocus: false`

Project mutations invalidate project queries after writes so the UI reloads fresh data.

## Common Files And Helpers

| File | Responsibility |
| --- | --- |
| `src/lib/api-client.ts` | Browser-side session storage and authenticated `fetch` wrapper. |
| `src/lib/auth.ts` | Server-side auth helpers, role helpers, and common JSON error responses. |
| `src/lib/jwt.ts` | JWT sign/verify helpers. |
| `src/lib/prisma.ts` | Prisma singleton client. |
| `src/lib/airtable-mock.ts` | In-memory Airtable test double/helper. Not wired into production routes in the current project. |
| `src/schemas/*.ts` | Zod request validation schemas. |
| `src/types/index.ts` | Shared frontend API/domain types and status constants. |
| `src/components/Header.tsx` | App header and logout. |
| `src/components/StatusColumn.tsx` | Board column by task status. |
| `src/components/TaskCard.tsx` | Individual board task card. |
| `src/components/TaskDetail.tsx` | Task edit/delete modal. |

## Seed Data

`prisma/seed.ts` clears existing data and creates:

- 5 users
- 3 projects
- Memberships with `admin`, `member`, and `viewer` roles
- 12 tasks across all statuses

All seeded users use password:

```text
password123
```

Example seeded accounts:

| Email | Access |
| --- | --- |
| `meera@taskboard.dev` | Admin on Q3 Launch and Internal Tools, member on Onboarding |
| `arjun@taskboard.dev` | Admin on Onboarding, member on Q3 Launch |
| `kavya@example.com` | Member on Q3 Launch |
| `dev@example.com` | Viewer on Q3 Launch |
| `lina@example.com` | Member on Onboarding |

## Environment And Setup

Required environment variables:

```text
DATABASE_URL="postgresql://taskboard:taskboard@localhost:5432/taskboard?schema=public"
JWT_SECRET="dev-secret-change-me"
NODE_ENV="development"
```

Optional Airtable-related variables exist in `.env.example`, but the current application routes do not use the real Airtable client.

Useful commands:

```bash
npm run dev
npm run build
npm test
npm run typecheck
npm run db:generate
npm run db:migrate
npm run db:migrate:dev
npm run db:seed
npm run db:reset
```

Docker Compose services:

- `db`: PostgreSQL 16
- `web`: Next.js dev server on port `3000`
- `test`: test runner container using test database URL

## Tests

Tests live in `src/tests`.

Current coverage includes:

- JWT signing/verifying behavior
- Zod auth schema validation
- Zod task schema validation
- TaskCard rendering behavior

Vitest is configured with jsdom and the `@` path alias.


