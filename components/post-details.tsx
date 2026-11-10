"use client";

/**
 * Post Details
 *
 * Panel opened from the overview table: the post's media, every insight
 * Instagram returns for it, rates derived from those numbers, the campaign
 * attached to it and the latest comments from other people.
 */

import type { Locale } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useState } from "react";
import type { PostDetailsResponse } from "@/app/api/instagram/post-details/route";

function formatNumber(n: number | null | undefined, locale: Locale): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString(locale);
}

function formatPercent(part: number | undefined, whole: number | undefined, locale: Locale): string {
  if (part === undefined || !whole) return "—";
  return `${((part / whole) * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
}

function formatDuration(ms: number | undefined, locale: Locale): string {
  if (ms === undefined) return "—";
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toLocaleString(locale, { maximumFractionDigits: 1 })}s`;
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.round(seconds / 60)} min`;
  return `${hours.toLocaleString(locale, { maximumFractionDigits: 1 })} h`;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-border p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export default function PostDetails({
  postId,
  instagramAccountId,
  onClose,
}: {
  postId: string;
  instagramAccountId: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<PostDetailsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ id: postId });
    if (instagramAccountId !== "all") params.set("instagramAccountId", instagramAccountId);
    fetch(`/api/instagram/post-details?${params}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setData(res.data);
        else setError(res.error ?? "Failed to load post details");
      })
      .catch(() => setError("Failed to load post details"));
  }, [postId, instagramAccountId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ins = data?.insights ?? null;
  const reach = ins?.reach;
  const views = ins?.views;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="panel relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-y-auto rounded p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-foreground">{t("Post details")}</h2>
          <div className="flex items-center gap-4 text-sm">
            {data?.permalink && (
              <a
                href={data.permalink}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                {t("Open on Instagram")}
              </a>
            )}
            <button type="button" onClick={onClose} className="text-muted hover:text-foreground">
              {t("Close")}
            </button>
          </div>
        </div>

        {error && (
          <p className="py-10 text-center text-sm text-error">
            {error === "Failed to load post details" ? t("Failed to load post details") : error}
          </p>
        )}

        {!data && !error && (
          <div className="grid gap-4 md:grid-cols-[280px_1fr]">
            <div className="aspect-[9/16] rounded bg-zinc-200/60" />
            <div className="grid grid-cols-2 gap-3 self-start sm:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-20 rounded bg-zinc-200/60" />
              ))}
            </div>
          </div>
        )}

        {data && (
          <div className="grid gap-6 md:grid-cols-[280px_1fr]">
            <div className="space-y-3">
              {data.isVideo && data.mediaUrl ? (
                <video
                  src={data.mediaUrl}
                  poster={data.thumbnailUrl ?? undefined}
                  controls
                  playsInline
                  className="w-full rounded bg-black"
                />
              ) : data.thumbnailUrl ? (
                <img
                  src={data.thumbnailUrl}
                  alt={data.caption?.slice(0, 50) ?? t("Instagram post")}
                  className="w-full rounded object-cover"
                />
              ) : (
                <div className="aspect-square rounded bg-zinc-200/60" />
              )}
              <p className="text-xs text-zinc-500">
                {data.mediaType} ·{" "}
                {new Date(data.timestamp).toLocaleString(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
              {data.caption && (
                <p className="max-h-48 overflow-y-auto whitespace-pre-line text-sm text-foreground">
                  {data.caption}
                </p>
              )}
            </div>

            <div className="space-y-6">
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {t("Performance")}
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Metric label={t("Views")} value={formatNumber(views, locale)} />
                  <Metric
                    label={t("Reach")}
                    value={formatNumber(reach, locale)}
                    hint={
                      data.followers && reach !== undefined
                        ? t("{percent} of your followers", {
                            percent: formatPercent(reach, data.followers, locale),
                          })
                        : undefined
                    }
                  />
                  <Metric label={t("Interactions")} value={formatNumber(ins?.total_interactions, locale)} />
                  <Metric label={t("Likes")} value={formatNumber(data.likes, locale)} />
                  <Metric label={t("Comments")} value={formatNumber(data.comments, locale)} />
                  <Metric label={t("Saved")} value={formatNumber(ins?.saved, locale)} />
                  <Metric label={t("Shares")} value={formatNumber(ins?.shares, locale)} />
                  {data.isVideo ? (
                    <>
                      <Metric
                        label={t("Average watch time")}
                        value={formatDuration(ins?.ig_reels_avg_watch_time, locale)}
                      />
                      <Metric
                        label={t("Total watch time")}
                        value={formatDuration(ins?.ig_reels_video_view_total_time, locale)}
                      />
                    </>
                  ) : (
                    <>
                      <Metric label={t("Profile visits")} value={formatNumber(ins?.profile_visits, locale)} />
                      <Metric label={t("Follows")} value={formatNumber(ins?.follows, locale)} />
                    </>
                  )}
                </div>
                {!ins && (
                  <p className="mt-2 text-xs text-zinc-500">
                    {t("Views, reach, saved and shares need the insights permission.")}
                  </p>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {t("Rates")}
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric
                    label={t("Engagement rate")}
                    value={formatPercent(ins?.total_interactions, reach, locale)}
                    hint={t("interactions ÷ reach")}
                  />
                  <Metric
                    label={t("Save rate")}
                    value={formatPercent(ins?.saved, reach, locale)}
                    hint={t("saves ÷ reach")}
                  />
                  <Metric
                    label={t("Share rate")}
                    value={formatPercent(ins?.shares, reach, locale)}
                    hint={t("shares ÷ reach")}
                  />
                  <Metric
                    label={t("Comment rate")}
                    value={formatPercent(data.comments, reach, locale)}
                    hint={t("comments ÷ reach")}
                  />
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {t("Campaigns")}
                </h3>
                {data.campaigns.length === 0 ? (
                  <p className="text-sm text-muted">{t("No campaign on this post.")}</p>
                ) : (
                  <div className="space-y-3">
                    {data.campaigns.map((c) => (
                      <div key={c.id} className="rounded border border-border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <a
                            href={`/campaigns/${c.id}`}
                            className="truncate text-sm font-medium text-foreground hover:text-accent"
                          >
                            {c.name}
                          </a>
                          <span className="text-xs text-zinc-500">
                            {c.isActive ? t("Active") : t("Paused")}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                          <div>
                            <p className="text-xs text-muted">{t("DMs sent")}</p>
                            <p className="font-semibold text-foreground">{formatNumber(c.dmsSent, locale)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted">{t("Link clicks")}</p>
                            <p className="font-semibold text-foreground">
                              {formatNumber(c.uniqueLinkClicks, locale)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted">{t("Click rate")}</p>
                            <p className="font-semibold text-foreground">
                              {formatPercent(c.uniqueLinkClicks, c.dmsSent, locale)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {t("Latest comments")}
                </h3>
                {data.recentComments.length === 0 ? (
                  <p className="text-sm text-muted">{t("No comments yet.")}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.recentComments.map((c, i) => (
                      <li key={i} className="py-2 text-sm">
                        <span className="font-medium text-foreground">
                          {c.username ? `@${c.username}` : t("Someone")}
                        </span>{" "}
                        <span className="text-foreground">{c.text}</span>
                        <span className="ml-2 text-xs text-zinc-500">
                          {new Date(c.timestamp).toLocaleDateString(locale, {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
