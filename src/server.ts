import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { z } from 'zod';

const app = new Hono();

const healthSchema = z.object({
  status: z.literal('ok')
});

app.get('/', (c) => {
  const payload = healthSchema.parse({ status: 'ok' });
  return c.json({
    message: 'Dompet Platform API',
    ...payload
  });
});

const port = Number(process.env.PORT ?? 3000);

serve({
  fetch: app.fetch,
  port
});

console.log(`🚀 Server listening on http://localhost:${port}`);
