import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { maybeGetDb, schema, type Database } from "../db/client";

interface JwtPayload {
  sub: string;
  tenantId: string;
  sid?: string;
  exp?: number;
  roles?: string[];
}

export interface AuthenticatedUser {
  userId: string;
  customerId: string;
  tenantId: string;
  sessionId?: string;
  roles?: string[];
}

export type AppContext = {
  Variables: {
    user?: AuthenticatedUser;
    db?: Database;
  };
};

const AUTH_SECRET = process.env.AUTH_SECRET ?? "dev-secret";

function base64UrlDecode(segment: string): Buffer {
  return Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function parseJson<T>(buffer: Buffer): T {
  try {
    const json = buffer.toString("utf8");
    return JSON.parse(json) as T;
  } catch (error) {
    throw new HTTPException(401, { message: "Invalid authentication payload" });
  }
}

function verifySignature(data: string, signature: string): boolean {
  const hmac = createHmac("sha256", AUTH_SECRET);
  const expected = hmac.update(data).digest();
  const received = base64UrlDecode(signature);
  if (expected.length !== received.length) {
    return false;
  }
  return timingSafeEqual(expected, received);
}

function parseJwt(token: string): JwtPayload | null {
  const segments = token.split(".");
  if (segments.length !== 3) {
    return null;
  }
  const [headerSegment, payloadSegment, signature] = segments;
  const header = parseJson<{ alg: string }>(base64UrlDecode(headerSegment));
  if (header.alg !== "HS256") {
    return null;
  }
  if (!verifySignature(`${headerSegment}.${payloadSegment}`, signature)) {
    return null;
  }
  const payload = parseJson<JwtPayload>(base64UrlDecode(payloadSegment));
  if (!payload.sub || !payload.tenantId) {
    return null;
  }
  if (typeof payload.exp === 'number' && Date.now() >= payload.exp * 1000) {
    return null;
  }
  return payload;
}

function parseCookies(header?: string): Record<string, string> {
  if (!header) {
    return {};
  }
  return header
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((accumulator, part) => {
      const [key, ...rest] = part.split("=");
      if (!key) {
        return accumulator;
      }
      accumulator[key] = decodeURIComponent(rest.join("="));
      return accumulator;
    }, {});
}

function extractToken(c: Context<AppContext>): string | null {
  const authHeader = c.req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim() || null;
  }
  const cookies = parseCookies(c.req.header("cookie"));
  if (cookies.session) {
    return cookies.session;
  }
  return null;
}

async function fetchUserRecord(
  db: Database | null,
  payload: JwtPayload,
): Promise<AuthenticatedUser> {
  if (!db) {
    return {
      userId: payload.sub,
      customerId: payload.sub,
      tenantId: payload.tenantId,
      sessionId: payload.sid,
      roles: payload.roles,
    };
  }
  const [customer] = await db
    .select({
      id: schema.customers.id,
      tenantId: schema.customers.tenantId,
      metadata: schema.customers.metadata,
    })
    .from(schema.customers)
    .where(eq(schema.customers.id, payload.sub))
    .limit(1);
  if (!customer || customer.tenantId !== payload.tenantId) {
    throw new HTTPException(401, { message: "Unauthorised user context" });
  }
  return {
    userId: customer.id,
    customerId: customer.id,
    tenantId: customer.tenantId,
    sessionId: payload.sid,
    roles: payload.roles,
  };
}

export async function requireUser(
  c: Context<AppContext>,
): Promise<AuthenticatedUser> {
  const cached = c.get("user");
  if (cached) {
    return cached;
  }
  const token = extractToken(c);
  if (!token) {
    throw new HTTPException(401, { message: "Authentication required" });
  }
  const payload = parseJwt(token);
  if (!payload) {
    throw new HTTPException(401, { message: "Invalid authentication token" });
  }
  const db = maybeGetDb();
  if (db) {
    c.set("db", db);
  }
  const user = await fetchUserRecord(db, payload);
  c.set("user", user);
  return user;
}

export function optionalUser(c: Context<AppContext>): AuthenticatedUser | undefined {
  return c.get("user");
}
