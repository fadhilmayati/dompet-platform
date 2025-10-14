# dompet-platform

Dompet orchestration

## Database migrations

This project uses [Drizzle ORM](https://orm.drizzle.team) for schema management. After updating `drizzle/schema.ts`, use the following commands to create SQL migrations and apply them to your database:

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

Both commands rely on a Postgres connection string exposed through `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL`, or `DATABASE_URL`.

## Local data and tooling scripts

Several utility scripts help populate demo content and exercise the Model Context Protocol (MCP) tooling end-to-end. All scripts expect a valid Postgres connection string in one of `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL`, or `DATABASE_URL`.

### Seed demo data

Populate the demo tenant with example users, transactions, rules, challenges, and badges:

```bash
npm run seed
```

### Exercise MCP tools

Run the smoke test that calls each MCP tool and verifies the responses. This command inserts a temporary transaction which is cleaned up automatically.

```bash
npm run test:mcp
```

### Run the 20 prompt regression suite

Execute the JSON validity regression harness against the chat endpoint. Override the endpoint with `CHAT_ENDPOINT` if it differs from the default `http://localhost:3000/chat`.

```bash
npm run eval:run
```
