"use client";

import { useMemo } from "react";

interface PlayerCardItem {
  player: {
    id: string;
    displayName: string;
    photoUrl: string | null;
    teamId: string;
    position: string;
    name?: string;
    sofascoreId?: number | null;
  };
  matchdayStatus?: {
    starter: boolean;
    officialSubstitute: boolean;
    shirtNumber: number | null;
  };
  tournament: {
    appearances: number;
    starts: number;
    totalMinutes: number;
    tournamentRating: number | null;
    recentFormRating: number | null;
    formTrend: string;
    sampleQuality: string;
    keyStats: Array<{ key: string; label: string; value: number | string }>;
    recentRatings?: number[];
  };
  traits: Array<{ key: string; label: string }>;
  personalHistory?: {
    timesSelected: number;
    averageRatingWhenSelected: number | null;
  };
}

interface GlobalPlayerCardProps {
  item: PlayerCardItem;
  teamName: string;
  getPlayerImageSrc: (player: any) => string;
  handlePlayerImageError: (player: any, e: React.SyntheticEvent<HTMLImageElement>) => void;
  onOpenPassport: (playerId: string) => void;
}

function ratingColorClass(rating: number | null): string {
  if (rating === null) return "grey";
  if (rating >= 7.5) return "green";
  if (rating >= 6.8) return "forest";
  if (rating >= 6.0) return "amber";
  return "red";
}

function ratingLabel(appearances: number, sampleQuality: string, rating: number | null): string {
  if (appearances === 0) return "NEW";
  if (rating === null) return "";
  if (sampleQuality === "low") return "EARLY";
  return "OVR";
}

function trendIcon(trend: string): { symbol: string; cls: string } | null {
  if (trend === "rising") return { symbol: "\u2197", cls: "rising" };
  if (trend === "declining") return { symbol: "\u2198", cls: "declining" };
  if (trend === "stable") return { symbol: "\u2192", cls: "stable" };
  return null;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name.slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function GlobalPlayerCard({
  item,
  teamName,
  getPlayerImageSrc,
  handlePlayerImageError,
  onOpenPassport,
}: GlobalPlayerCardProps) {
  const { player, tournament, traits, personalHistory, matchdayStatus } = item;
  const imgSrc = useMemo(() => getPlayerImageSrc(player), [player]);

  const appearances = tournament.appearances;
  const rating = tournament.tournamentRating;
  const formRating = tournament.recentFormRating;
  const trend = trendIcon(tournament.formTrend);
  const colorCls = ratingColorClass(rating);
  const label = ratingLabel(appearances, tournament.sampleQuality, rating);
  const shirtNumber = matchdayStatus?.shirtNumber ?? null;

  // Real recent ratings from API (may be empty)
  const recentRatings = tournament.recentRatings ?? [];
  const hasFormData = formRating !== null || recentRatings.length > 0;

  // Display max 2 real traits
  const displayTraits = traits.slice(0, 2);

  // Personal history — only from real data
  const hasHistory = personalHistory && personalHistory.timesSelected > 0;

  const ariaLabel = `${player.displayName}, ${teamName} ${player.position.toLowerCase()}, tournament rating ${rating !== null ? rating.toFixed(1) : "not available"}`;

  return (
    <button
      className="players-card"
      onClick={() => onOpenPassport(player.id)}
      aria-label={ariaLabel}
    >
      {/* Avatar */}
      <div className="players-card-avatar">
        <img
          src={imgSrc}
          alt={player.displayName}
          loading="lazy"
          onError={(e) => {
            // Hide broken image, show initials fallback
            const target = e.currentTarget;
            handlePlayerImageError(player, e);
            // If still broken after fallback chain, hide the img
            target.onerror = () => {
              target.style.display = "none";
              const parent = target.parentElement;
              if (parent && !parent.querySelector(".players-card-avatar-initials")) {
                const el = document.createElement("div");
                el.className = "players-card-avatar-initials";
                el.textContent = getInitials(player.displayName);
                parent.appendChild(el);
              }
            };
          }}
        />
        {shirtNumber !== null && (
          <span className="players-card-shirt">{shirtNumber}</span>
        )}
      </div>

      {/* Centre */}
      <div className="players-card-body">
        <span className="players-card-name">{player.displayName}</span>
        <div className="players-card-meta">
          <span>{teamName}</span>
          <span>·</span>
          <b>{player.position}</b>
          <span>·</span>
          <span>
            {appearances} {appearances === 1 ? "appearance" : "appearances"}
          </span>
        </div>

        {/* Position-specific Key Stats Row */}
        {tournament.keyStats && tournament.keyStats.length > 0 && (
          <div className="players-card-keystats" style={{ display: "flex", gap: "4px", marginTop: "5px", alignItems: "center", flexWrap: "wrap", fontSize: "10px", color: "var(--muted)" }}>
            {tournament.keyStats.map((stat, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                {i > 0 && <span style={{ marginRight: "3px", opacity: 0.5 }}>·</span>}
                <strong style={{ color: "var(--ink)" }}>{stat.value}</strong> {stat.label}
              </span>
            ))}
          </div>
        )}

        {/* Form strip — real data only */}
        {hasFormData && (
          <div className="players-card-form">
            <span className="players-card-form-label">Form</span>
            {recentRatings.length > 0 ? (
              recentRatings.slice(-4).map((r: number, i: number, arr: number[]) => (
                <span
                  key={i}
                  className={`players-card-form-val${i === arr.length - 1 ? " latest" : ""}`}
                >
                  {r.toFixed(1)}
                </span>
              ))
            ) : formRating !== null ? (
              <span className="players-card-form-val latest">
                {formRating.toFixed(1)}
              </span>
            ) : null}
            {trend && (
              <span className={`players-card-trend ${trend.cls}`}>
                {trend.symbol}
              </span>
            )}
          </div>
        )}

        {/* Tags row: real traits + real personal history */}
        {(displayTraits.length > 0 || hasHistory) && (
          <div className="players-card-tags">
            {displayTraits.map((t) => (
              <span key={t.key} className="players-card-trait">
                {t.label}
              </span>
            ))}
            {hasHistory && (
              <span className="players-card-history">
                Selected {personalHistory!.timesSelected} {personalHistory!.timesSelected === 1 ? "time" : "times"}
                {personalHistory!.averageRatingWhenSelected !== null &&
                  ` · Avg ${personalHistory!.averageRatingWhenSelected.toFixed(1)}`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Rating column */}
      <div className="players-card-rating">
        <span className={`players-card-rating-val ${colorCls}`}>
          {appearances === 0 ? "NEW" : rating !== null ? rating.toFixed(1) : "\u2014"}
        </span>
        {label && label !== "NEW" && (
          <span className="players-card-rating-label">{label}</span>
        )}
        <span className="players-card-chevron">&rsaquo;</span>
      </div>
    </button>
  );
}
