# AI Coding Instructions

## Assignment Rules

- Do not modify seed data.
- Do not squash commits.
- Preserve meaningful commit history.
- Use small, focused commits.
- Do not remove or bypass existing tests.
- Do not hardcode secrets.
- Use environment variables for Airtable credentials.
- Keep authorization checks server-side.
- Add tests for bug fixes and new features.

## Seed Data Rule

Do not edit any seed data files, including but not limited to:

- `prisma/seed.ts`
- `prisma/seed.js`
- `seed.ts`
- `seed.sql`

If tests need data, create test-specific fixtures or use existing seeded records without changing the seed file.
