import { createDMWorker } from "@/lib/queue/dm-worker";
import { prisma } from "@/lib/db/client";
import { recordWorkerHeartbeat } from "@/lib/ops/worker-health";
import { reconcileComments } from "@/lib/polling/comment-reconciler";
import { attachPendingNextReels } from "@/lib/automation/attach-next-reel";
import os from "node:os";

const worker = createDMWorker();
const startedAt = new Date().toISOString();
const HEARTBEAT_INTERVAL_MS = 30_000;
// Polling safety net for comments that webhooks miss. Runs in the worker because
// it must fire every few minutes and Vercel's free crons only run once a day.
const POLL_INTERVAL_MS = Number(
  process.env.COMMENT_POLL_INTERVAL_MS ?? 5 * 60_000
);

console.log("[DM Worker] Started");

async function heartbeat() {
  try {
    await recordWorkerHeartbeat({
      pid: process.pid,
      hostname: os.hostname(),
      startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Heartbeat failed:", message);
  }
}

void heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);

// The heartbeat lives in Redis, so it stays green even when the database is
// unreachable and every job is stuck waiting on it. Probe the database too and
// exit after a few straight failures: the supervisor restarts the process with
// fresh connections.
const DB_PROBE_TIMEOUT_MS = 20_000;
const DB_PROBE_MAX_FAILURES = 4;
let dbProbeFailures = 0;

async function probeDatabase() {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timed out")), DB_PROBE_TIMEOUT_MS)
      ),
    ]);
    dbProbeFailures = 0;
  } catch (error) {
    dbProbeFailures++;
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(
      `[DM Worker] Database probe failed (${dbProbeFailures}/${DB_PROBE_MAX_FAILURES}):`,
      message
    );
    if (dbProbeFailures >= DB_PROBE_MAX_FAILURES) {
      console.error("[DM Worker] Database unreachable, exiting for a restart");
      process.exit(1);
    }
  }
}

const dbProbeTimer = setInterval(() => void probeDatabase(), HEARTBEAT_INTERVAL_MS);

async function poll() {
  try {
    const attached = await attachPendingNextReels();
    if (attached.bound > 0 || attached.failedAccounts > 0) {
      console.log("[DM Worker] Next-reel attachment:", attached);
    }
    await reconcileComments();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Comment reconciliation failed:", message);
  }
}

// Kick off one sweep shortly after boot, then on a fixed interval.
setTimeout(() => void poll(), 10_000);
const pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);

async function shutdown(signal: string) {
  console.log(`[DM Worker] ${signal} received, closing worker`);
  clearInterval(heartbeatTimer);
  clearInterval(dbProbeTimer);
  clearInterval(pollTimer);
  await worker.close();
  process.exit(0);
}

// A single failed promise or socket must not stop DM delivery; log and keep going.
process.on("unhandledRejection", (reason) => {
  console.error("[DM Worker] Unhandled rejection:", reason);
});
// After an uncaught exception the process state is unknown, so staying up can
// leave a worker that looks alive but delivers nothing. Exit and let the
// supervisor restart it.
process.on("uncaughtException", (error) => {
  console.error("[DM Worker] Uncaught exception, exiting:", error);
  process.exit(1);
});

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
