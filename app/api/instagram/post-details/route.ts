import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import {
  createInstagramContext,
  getMedia,
  getMediaInsights,
  getRecentMediaComments,
  getUserInfo,
  type InstagramMediaInsights,
} from "@/lib/instagram/provider";

export const maxDuration = 30;

const REEL_METRICS = [
  "views",
  "reach",
  "saved",
  "shares",
  "total_interactions",
  "ig_reels_avg_watch_time",
  "ig_reels_video_view_total_time",
];
const FEED_METRICS = [
  "views",
  "reach",
  "saved",
  "shares",
  "total_interactions",
  "follows",
  "profile_visits",
];

export interface PostDetailsResponse {
  id: string;
  caption: string | null;
  permalink: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  mediaType: string;
  isVideo: boolean;
  timestamp: string;
  likes: number;
  /** Comments written by other people (the account's own replies excluded). */
  comments: number;
  insights: InstagramMediaInsights | null;
  followers: number | null;
  recentComments: Array<{ username: string | null; text: string; timestamp: string }>;
  campaigns: Array<{
    id: string;
    name: string;
    isActive: boolean;
    dmsSent: number;
    linkClicks: number;
    uniqueLinkClicks: number;
  }>;
}

/**
 * Insights for one post. Meta rejects the whole request when one metric does
 * not apply to the media, so fall back to asking metric by metric.
 */
async function loadInsights(
  context: Awaited<ReturnType<typeof createInstagramContext>>,
  mediaId: string,
  metrics: string[]
): Promise<InstagramMediaInsights | null> {
  try {
    return await getMediaInsights({ context, mediaId, metrics });
  } catch {
    const parts = await Promise.all(
      metrics.map((metric) =>
        getMediaInsights({ context, mediaId, metrics: [metric] }).catch(() => null)
      )
    );
    const merged = Object.assign({}, ...parts.filter(Boolean));
    return Object.keys(merged).length > 0 ? merged : null;
  }
}

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const mediaId = request.nextUrl.searchParams.get("id");
  if (!mediaId || !/^[\w-]+$/.test(mediaId)) {
    return NextResponse.json(
      { success: false, error: "Missing post id" },
      { status: 400 }
    );
  }

  const account = await getWorkspaceInstagramAccount(
    workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Instagram account not connected." },
      { status: 400 }
    );
  }

  try {
    const context = await createInstagramContext(account);
    const media = await getMedia({ context, mediaId });
    if (!media) {
      return NextResponse.json(
        { success: false, error: "Post not found" },
        { status: 404 }
      );
    }

    const isVideo =
      media.media_product_type === "REELS" || media.media_type === "VIDEO";

    const [insights, commentList, info, automations] = await Promise.all([
      loadInsights(context, mediaId, isVideo ? REEL_METRICS : FEED_METRICS),
      media.comments_count
        ? getRecentMediaComments({ context, mediaId, sinceMs: 0, max: 2000 }).catch(
            () => null
          )
        : Promise.resolve([]),
      getUserInfo({ context }).catch(() => null),
      prisma.automation.findMany({
        where: { workspaceId, instagramAccountId: account.id, postId: mediaId },
        select: { id: true, name: true, isActive: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const audience = commentList?.filter((c) => c.from?.id !== account.instagramId);

    const campaigns = await Promise.all(
      automations.map(async (a) => {
        const [dmsSent, clicks] = await Promise.all([
          prisma.dmLog.count({ where: { automationId: a.id, status: "SENT" } }),
          prisma.linkClick.findMany({
            where: { automationId: a.id },
            select: { recipientHash: true, ipHash: true },
          }),
        ]);
        const unique = new Set(clicks.map((c) => c.recipientHash ?? c.ipHash ?? ""));
        unique.delete("");
        return {
          ...a,
          dmsSent,
          linkClicks: clicks.length,
          uniqueLinkClicks: unique.size,
        };
      })
    );

    const data: PostDetailsResponse = {
      id: media.id,
      caption: media.caption?.trim() ?? null,
      permalink: media.permalink ?? null,
      mediaUrl: media.media_url ?? null,
      thumbnailUrl: media.thumbnail_url ?? media.media_url ?? null,
      mediaType: media.media_product_type ?? media.media_type,
      isVideo,
      timestamp: media.timestamp,
      likes: media.like_count ?? 0,
      comments: audience ? audience.length : (media.comments_count ?? 0),
      insights,
      followers: info?.followers_count ?? null,
      recentComments: (audience ?? []).slice(0, 8).map((c) => ({
        username: c.from?.username ?? null,
        text: c.text,
        timestamp: c.timestamp,
      })),
      campaigns,
    };

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[Post Details] Error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to load post details" },
      { status: 500 }
    );
  }
}
