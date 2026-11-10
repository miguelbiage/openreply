import { NextRequest, NextResponse } from "next/server";
import { attachPendingNextReels } from "@/lib/automation/attach-next-reel";
import { reconcileComments } from "@/lib/polling/comment-reconciler";
import { drainDMQueue } from "@/lib/queue/dm-worker";

/**
 * Serverless stand-in for the long-running DM worker.
 *
 * Webhooks drain the queue themselves, so this route covers what they can't:
 * delayed jobs (retries, follow-ups, follow re-checks) coming due, comments the
 * webhooks missed, and "next reel" campaigns. Vercel's free crons only run
 * daily, so an external scheduler (.github/workflows/process-queue.yml) calls
 * it every few minutes.
 */

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const attached = await attachPendingNextReels().catch((error: unknown) => {
    console.error("[process-queue] Next-reel attachment failed:", error);
    return null;
  });
  await reconcileComments().catch((error: unknown) => {
    console.error("[process-queue] Comment reconciliation failed:", error);
  });
  const drained = await drainDMQueue({ budgetMs: 30_000 });

  return NextResponse.json({
    success: true,
    data: { attached, drained },
  });
}
