import { createDMWorker } from "@/lib/queue/dm-worker";
import { prisma } from "@/lib/db/client";
import { getDMQueue, getRedisConnection } from "@/lib/queue/client";
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

// The heartbeat only proves the process can write to Redis. After a network
// drop the database pool or BullMQ's blocking Redis connection can stay dead
// while the heartbeat recovers, and comments pile up in the queue unanswered.
// Probe all three every 30s and exit after a few straight failures: the
// supervisor restarts the process with fresh connections.
const PROBE_TIMEOUT_MS = 20_000;
const PROBE_MAX_FAILURES = 4;
// A job waiting this long means nothing is pulling from the queue.
const STALE_WAITING_JOB_MS = 3 * 60_000;
let probeFailures = 0;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), PROBE_TIMEOUT_MS)
    ),
  ]);
}

async function probeHealth() {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, "database");
    await withTimeout(getRedisConnection().ping(), "redis");
    const [oldest] = await withTimeout(getDMQueue().getWaiting(-1, -1), "queue");
    if (oldest && Date.now() - oldest.timestamp > STALE_WAITING_JOB_MS) {
      throw new Error(`job ${oldest.id} waiting since ${new Date(oldest.timestamp).toISOString()}`);
    }
    probeFailures = 0;
  } catch (error) {
    probeFailures++;
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(
      `[DM Worker] Health probe failed (${probeFailures}/${PROBE_MAX_FAILURES}):`,
      message
    );
    if (probeFailures >= PROBE_MAX_FAILURES) {
      console.error("[DM Worker] Not delivering, exiting for a restart");
      process.exit(1);
    }
  }
}

const probeTimer = setInterval(() => void probeHealth(), HEARTBEAT_INTERVAL_MS);

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
  clearInterval(probeTimer);
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
