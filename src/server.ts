import 'dotenv/config';
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { apiRouter } from "./api/v1";
import type { AppContext } from "./api/auth";

const app = new Hono<AppContext>();

const healthSchema = z.object({
  status: z.literal("ok"),
});

app.get("/", (c) => {
  const payload = healthSchema.parse({ status: "ok" });
  return c.json({
    message: "Dompet Platform API",
    ...payload,
  });
});

app.get("/v1/healthz", (c) => c.json({ ok: true }));

app.route("/v1", apiRouter);
app.route("/api/v1", apiRouter);

const port = Number(process.env.PORT ?? 3000);

serve({
  fetch: app.fetch,
  port
});

console.log(`🚀 Server listening on http://localhost:${port}`);
