"use client";

import { useEffect, useMemo, useState } from "react";
import { GlobalPlayerCard } from "./GlobalPlayerCard";
import { PlayersEmptyState, PlayersSkeleton } from "./PlayersEmptyState";

/** Canonical competition ID used by the database */
const WORLD_CUP_COMPETITION_ID = "72";

interface TeamSummary {
  id: string;
  name: string;
  matches: any[];
  supported: number;
}

interface PlayersScreenProps {
  teams: TeamSummary[];
  fixtures: any[];
  wallet: string;
  getPlayerImageSrc: (player: any) => string;
  handlePlayerImageError: (player: any, e: React.SyntheticEvent<HTMLImageElement>) => void;
  onOpenPassport: (playerId: string) => void;
}

type ContextFilter = "all" | "primary" | "trusted";
type PosFilter = "ALL" | "ATT" | "MID" | "DEF" | "GK";
type SortMode = "recommended" | "form" | "rating" | "minutes";

const POSITIONS: PosFilter[] = ["ALL", "ATT", "MID", "DEF", "GK"];
const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "recommended", label: "Recommended" },
  { value: "form", label: "Form" },
  { value: "rating", label: "Rating" },
  { value: "minutes", label: "Minutes" },
];

export function PlayersScreen({
  teams,
  fixtures,
  wallet,
  getPlayerImageSrc,
  handlePlayerImageError,
  onOpenPassport,
}: PlayersScreenProps) {
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [contextFilter, setContextFilter] = useState<ContextFilter>("all");
  const [posFilter, setPosFilter] = useState<PosFilter>("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("recommended");

  const primaryTeam = useMemo(() => {
    const supported = teams.find((t) => t.supported > 0);
    return supported || null;
  }, [teams]);

  const fetchPlayers = () => {
    setLoading(true);
    setError(false);
    const walletParam = wallet ? `&wallet=${wallet}` : "";
    const posParam = posFilter !== "ALL" ? `&position=${posFilter}` : "";
    fetch(
      `/api/data/players/repository?competitionId=${WORLD_CUP_COMPETITION_ID}&sort=${sortMode}${posParam}${walletParam}`
    )
      .then((res) => res.json())
      .then((data) => {
        setPlayers(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchPlayers();
  }, [sortMode, posFilter, wallet]);

  // Build team name lookup
  const teamNameMap = useMemo(() => {
    const map = new Map<string, string>();
    teams.forEach((t) => map.set(t.id, t.name));
    return map;
  }, [teams]);

  // Next fixture for "Players to Watch"
  const nextFixtureInfo = useMemo(() => {
    if (!primaryTeam) return null;
    const now = Date.now();
    const next = fixtures.find((f: any) => {
      const t = new Date(f.startsAt).getTime();
      return (
        t > now &&
        (f.homeTeamId === primaryTeam.id || f.awayTeamId === primaryTeam.id)
      );
    });
    if (!next) return null;
    const opponentId =
      next.homeTeamId === primaryTeam.id ? next.awayTeamId : next.homeTeamId;
    const opponentName = teamNameMap.get(opponentId) || "Opposition";
    return { fixture: next, opponentId, opponentName };
  }, [primaryTeam, fixtures, teamNameMap]);

  // Client-side filtering
  const filtered = useMemo(() => {
    return players.filter((item) => {
      // Context filter
      if (contextFilter === "primary" && primaryTeam) {
        if (item.player.teamId !== primaryTeam.id) return false;
      }
      if (contextFilter === "trusted") {
        if (!item.personalHistory || item.personalHistory.timesSelected <= 0) return false;
      }

      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const name = (item.player.name || "").toLowerCase();
        const disp = (item.player.displayName || "").toLowerCase();
        const country = (teamNameMap.get(item.player.teamId) || "").toLowerCase();
        const pos = (item.player.position || "").toLowerCase();
        if (!name.includes(q) && !disp.includes(q) && !country.includes(q) && !pos.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [players, contextFilter, primaryTeam, searchQuery, teamNameMap]);

  // Partition into sections
  const sections = useMemo(() => {
    if (searchQuery.trim() || contextFilter !== "all") {
      return { mode: "flat" as const, items: filtered };
    }

    const primaryItems = primaryTeam
      ? filtered.filter((item) => item.player.teamId === primaryTeam.id)
      : [];
    const watchItems = nextFixtureInfo
      ? filtered.filter((item) => item.player.teamId === nextFixtureInfo.opponentId)
      : [];
    const primaryIds = new Set(primaryItems.map((i: any) => i.player.id));
    const watchIds = new Set(watchItems.map((i: any) => i.player.id));
    const others = filtered.filter(
      (item) => !primaryIds.has(item.player.id) && !watchIds.has(item.player.id)
    );

    return {
      mode: "sections" as const,
      primaryItems: primaryItems.slice(0, 5),
      watchItems: watchItems.slice(0, 5),
      others,
      primaryTeamName: primaryTeam?.name || "",
      watchInfo: nextFixtureInfo,
    };
  }, [filtered, searchQuery, contextFilter, primaryTeam, nextFixtureInfo]);

  const hasActiveFilters = searchQuery.trim() !== "" || contextFilter !== "all" || posFilter !== "ALL";

  const clearFilters = () => {
    setSearchQuery("");
    setContextFilter("all");
    setPosFilter("ALL");
    setSortMode("recommended");
  };

  const resolveTeamName = (teamId: string) => teamNameMap.get(teamId) ?? "Unknown";

  // Whether "Most Trusted" should show: only when wallet exists and there's real history data
  const showTrustedFilter = wallet && players.some((item) => item.personalHistory?.timesSelected > 0);
  // Use "Most Experienced" as transparent fallback label when no wallet
  const trustedLabel = wallet ? "Most Trusted" : "Most Experienced";
  const showTrustedChip = wallet || false;

  return (
    <div className="screen enter players-page">
      {/* ── Header ── */}
      <div className="players-page-header">
        <span className="eyebrow">WORLD CUP PLAYERS</span>
        <h1>Players</h1>
        <p>Explore every player's World Cup journey.</p>
      </div>

      {/* ── Search ── */}
      <div className="players-search-wrap">
        <span className="players-search-icon" aria-hidden="true">&#x1F50D;</span>
        <input
          className="players-search"
          type="text"
          placeholder="Search players, teams, or positions"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search players, teams, or positions"
        />
        {searchQuery && (
          <button
            className="players-search-clear"
            onClick={() => setSearchQuery("")}
            aria-label="Clear search"
          >
            &times;
          </button>
        )}
      </div>

      {/* ── Context filters ── */}
      <div className="players-context-filters">
        <button
          className={`players-context-btn${contextFilter === "all" ? " active" : ""}`}
          onClick={() => setContextFilter("all")}
          aria-pressed={contextFilter === "all"}
        >
          All Players
        </button>
        {primaryTeam && (
          <button
            className={`players-context-btn${contextFilter === "primary" ? " active" : ""}`}
            onClick={() => setContextFilter("primary")}
            aria-pressed={contextFilter === "primary"}
          >
            {primaryTeam.name}
          </button>
        )}
        {showTrustedChip && (
          <button
            className={`players-context-btn${contextFilter === "trusted" ? " active" : ""}`}
            onClick={() => setContextFilter("trusted")}
            aria-pressed={contextFilter === "trusted"}
          >
            {trustedLabel}
          </button>
        )}
      </div>

      {/* ── Position + Sort controls ── */}
      <div className="players-controls-row">
        <div className="players-pos-group">
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              className={`players-pos-btn${posFilter === pos ? " active" : ""}`}
              onClick={() => setPosFilter(pos)}
              aria-pressed={posFilter === pos}
            >
              {pos}
            </button>
          ))}
        </div>
        <select
          className="players-sort-select"
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          aria-label="Sort players"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* ── Content ── */}
      {loading ? (
        <PlayersSkeleton />
      ) : error ? (
        <PlayersEmptyState type="error" onRetry={fetchPlayers} />
      ) : filtered.length === 0 ? (
        contextFilter === "trusted" ? (
          <PlayersEmptyState type="no-trusted" />
        ) : contextFilter === "primary" ? (
          <PlayersEmptyState type="no-team" />
        ) : (
          <PlayersEmptyState type="no-results" />
        )
      ) : (
        <>
          {/* Result bar when searching/filtering */}
          {hasActiveFilters && (
            <div className="players-result-bar">
              <span>
                {filtered.length}{" "}
                {posFilter !== "ALL"
                  ? `${posFilter === "ATT" ? "attacker" : posFilter === "MID" ? "midfielder" : posFilter === "DEF" ? "defender" : "goalkeeper"}${filtered.length !== 1 ? "s" : ""}`
                  : `player${filtered.length !== 1 ? "s" : ""}`}
              </span>
              <button onClick={clearFilters}>Clear filters</button>
            </div>
          )}

          {sections.mode === "sections" ? (
            <>
              {/* Primary team section */}
              {sections.primaryItems.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div className="players-section-header">
                    <h3>Your {sections.primaryTeamName} Players</h3>
                    <span>{sections.primaryItems.length} players</span>
                  </div>
                  {sections.primaryItems.map((item: any) => (
                    <GlobalPlayerCard
                      key={item.player.id}
                      item={item}
                      teamName={resolveTeamName(item.player.teamId)}
                      getPlayerImageSrc={getPlayerImageSrc}
                      handlePlayerImageError={handlePlayerImageError}
                      onOpenPassport={onOpenPassport}
                    />
                  ))}
                </div>
              )}

              {/* Players to Watch */}
              {sections.watchItems.length > 0 && sections.watchInfo && (
                <div style={{ marginBottom: 16 }}>
                  <div className="players-section-header">
                    <h3>Players to Watch</h3>
                    <span>{sections.watchItems.length} players</span>
                  </div>
                  <p className="players-section-sub">
                    {sections.watchInfo.opponentName} players before {primaryTeam?.name} vs {sections.watchInfo.opponentName}
                  </p>
                  {sections.watchItems.map((item: any) => (
                    <GlobalPlayerCard
                      key={item.player.id}
                      item={item}
                      teamName={resolveTeamName(item.player.teamId)}
                      getPlayerImageSrc={getPlayerImageSrc}
                      handlePlayerImageError={handlePlayerImageError}
                      onOpenPassport={onOpenPassport}
                    />
                  ))}
                </div>
              )}

              {/* All World Cup Players */}
              {sections.others.length > 0 && (
                <div>
                  <div className="players-section-header">
                    <h3>All World Cup Players</h3>
                    <span>{sections.others.length} players</span>
                  </div>
                  {sections.others.map((item: any) => (
                    <GlobalPlayerCard
                      key={item.player.id}
                      item={item}
                      teamName={resolveTeamName(item.player.teamId)}
                      getPlayerImageSrc={getPlayerImageSrc}
                      handlePlayerImageError={handlePlayerImageError}
                      onOpenPassport={onOpenPassport}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            /* Flat filtered list */
            filtered.map((item: any) => (
              <GlobalPlayerCard
                key={item.player.id}
                item={item}
                teamName={resolveTeamName(item.player.teamId)}
                getPlayerImageSrc={getPlayerImageSrc}
                handlePlayerImageError={handlePlayerImageError}
                onOpenPassport={onOpenPassport}
              />
            ))
          )}
        </>
      )}
    </div>
  );
}
