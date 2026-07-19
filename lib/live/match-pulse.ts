import type { MatchPulseUpdate } from "./types";

type TxLineOddsMarket = {
  MarketTypeId?: number;
  marketTypeId?: number;
  Outcomes?: TxLineOddsOutcome[];
  outcomes?: TxLineOddsOutcome[];
};

type TxLineOddsOutcome = {
  /** 1 = participant 1 win, 2 = participant 2 win, 3 = draw */
  OutcomeTypeId?: number;
  outcomeTypeId?: number;
  /** Decimal odds e.g. 2.5 */
  DecimalOdds?: number;
  decimalOdds?: number;
  Price?: number;
  price?: number;
};

/** Raw TxLINE odds payload from SSE stream */
export type TxLineOddsPayload = {
  FixtureId?: string | number;
  fixtureId?: string | number;
  Markets?: TxLineOddsMarket[];
  markets?: TxLineOddsMarket[];
  Timestamp?: string;
  timestamp?: string;
};

// ─── Match 1×2 market type ID (standard across TxLINE) ─────────────────────
const MATCH_RESULT_MARKET_TYPE_ID = 1; // 1×2 result market

// ─── MatchPulse Class ────────────────────────────────────────────────────────

export class MatchPulse {
  private fixtureId: string;
  private participant1Name: string;
  private participant2Name: string;
  /** History of last 5 outlook snapshots for shift calculation */
  private history: Array<{ p1: number; p2: number; draw: number; ts: string }> = [];

  constructor(fixtureId: string, participant1Name: string, participant2Name: string) {
    this.fixtureId = fixtureId;
    this.participant1Name = participant1Name;
    this.participant2Name = participant2Name;
  }

  /**
   * Process a raw odds payload from the TxLINE stream.
   * Returns a MatchPulseUpdate if the 1×2 market is present, otherwise null.
   */
  processOddsPayload(payload: TxLineOddsPayload): MatchPulseUpdate | null {
    const markets = payload.Markets ?? payload.markets ?? [];
    if (markets.length === 0) return null;

    // Find the 1×2 result market
    const resultMarket = markets.find((m) => {
      const typeId = m.MarketTypeId ?? m.marketTypeId ?? -1;
      return typeId === MATCH_RESULT_MARKET_TYPE_ID;
    });
    if (!resultMarket) return null;

    const outcomes = resultMarket.Outcomes ?? resultMarket.outcomes ?? [];
    if (outcomes.length === 0) return null;

    // Extract decimal odds for each outcome
    let p1Odds: number | null = null;
    let p2Odds: number | null = null;
    let drawOdds: number | null = null;

    for (const outcome of outcomes) {
      const typeId = outcome.OutcomeTypeId ?? outcome.outcomeTypeId ?? 0;
      const odds =
        outcome.DecimalOdds ?? outcome.decimalOdds ?? outcome.Price ?? outcome.price ?? 0;

      if (odds <= 1) continue; // Invalid odds — skip

      if (typeId === 1) p1Odds = odds;
      else if (typeId === 2) p2Odds = odds;
      else if (typeId === 3) drawOdds = odds;
    }

    // Need at least p1 and p2 to compute
    if (p1Odds === null || p2Odds === null) return null;

    // Convert to implied probabilities and remove bookmaker margin
    const rawP1 = 1 / p1Odds;
    const rawP2 = 1 / p2Odds;
    const rawDraw = drawOdds !== null ? 1 / drawOdds : 0;
    const totalRaw = rawP1 + rawP2 + rawDraw;

    if (totalRaw <= 0) return null;

    // Margin-removed probabilities (normalised to sum to 1)
    const normP1 = rawP1 / totalRaw;
    const normP2 = rawP2 / totalRaw;
    const normDraw = rawDraw / totalRaw;

    // Convert to percentages (round to 1 decimal)
    const p1Pct = Math.round(normP1 * 1000) / 10;
    const p2Pct = Math.round(normP2 * 1000) / 10;
    const drawPct = Math.round(normDraw * 1000) / 10;

    const ts = payload.Timestamp ?? payload.timestamp ?? new Date().toISOString();

    // Calculate shift vs most recent snapshot
    const prev = this.history[this.history.length - 1];
    let shift = 0;
    let shiftDirection: MatchPulseUpdate["shiftDirection"] = "neutral";
    let shiftLabel = "";

    if (prev) {
      const p1Shift = p1Pct - prev.p1;
      const p2Shift = p2Pct - prev.p2;

      shift = Math.round(Math.abs(p1Shift) * 10) / 10;

      if (Math.abs(p1Shift) >= Math.abs(p2Shift)) {
        shiftDirection = p1Shift > 0 ? "participant1" : "participant2";
        if (shift >= 2) {
          // Only emit label for meaningful shifts (≥2%)
          const teamName =
            shiftDirection === "participant1" ? this.participant1Name : this.participant2Name;
          shiftLabel = `Momentum shifted toward ${teamName} ▲${shift.toFixed(1)}%`;
        }
      } else {
        shiftDirection = p2Shift > 0 ? "participant2" : "participant1";
        if (shift >= 2) {
          const teamName =
            shiftDirection === "participant2" ? this.participant2Name : this.participant1Name;
          shiftLabel = `Momentum shifted toward ${teamName} ▲${shift.toFixed(1)}%`;
        }
      }
    }

    // Store in history (max 5 entries)
    this.history.push({ p1: p1Pct, p2: p2Pct, draw: drawPct, ts });
    if (this.history.length > 5) this.history.shift();

    return {
      participant1Outlook: p1Pct,
      participant2Outlook: p2Pct,
      drawOutlook: drawPct,
      shift,
      shiftDirection,
      shiftLabel,
      ts,
      quality: "live",
    };
  }

  /** Returns a placeholder update for when odds data is unavailable */
  static unavailable(): MatchPulseUpdate {
    return {
      participant1Outlook: 50,
      participant2Outlook: 50,
      drawOutlook: 0,
      shift: 0,
      shiftDirection: "neutral",
      shiftLabel: "",
      ts: new Date().toISOString(),
      quality: "unavailable",
    };
  }
}
