import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "@/app/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  // Without an explicit cap, pg.Pool opens up to 10 connections per process and
  // the adapter was only given the connection string. On serverless every warm
  // instance builds its own pool, so two of them already exceeded the 15
  // connections of Supabase's free session pooler — surfacing as Prisma's
  // "Can't reach database server", which reads like an outage rather than an
  // exhausted pool. The cap is per-environment: small on Vercel, a bit higher
  // on the worker, which is a single long-lived process.
  const pool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DB_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
  });

  // Prisma Migrate honours `?schema=` in the URL but the pg adapter does not, so
  // pass it through, and point raw SQL at it too. Lets OpenReply live in its own
  // schema inside a database that already has tables in `public`.
  const schema = new URL(databaseUrl).searchParams.get("schema") ?? undefined;
  if (schema) {
    const quoted = `"${schema.replace(/"/g, '""')}"`;
    pool.on("connect", (client) => {
      void client.query(`SET search_path TO ${quoted}, public`);
    });
  }

  return new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
}

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }

  return globalForPrisma.prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getPrisma(), prop, receiver);
  },
});
