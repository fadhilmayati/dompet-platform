# dompet-platform

Dompet orchestration

## Database migrations

This project uses [Drizzle ORM](https://orm.drizzle.team) for schema management. After updating `drizzle/schema.ts`, use the following commands to create SQL migrations and apply them to your database:

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

Both commands rely on a Postgres connection string exposed through `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL`, or `DATABASE_URL`.
