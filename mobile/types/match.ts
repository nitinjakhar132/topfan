import { RouteProp } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";

export type PositionKey = "ATT" | "MID" | "DEF" | "GK";

export interface PlayerStats {
  minutes: number;
  goals: number;
  assists: number;
  chancesCreated: number;
  tackles: number;
  shotsOnTarget: number;
  yellowCards: number;
  redCards: number;
  ownGoals: number;
  impactRating: number | null;
}

export interface LivePlayer {
  id: string;
  sofascoreId?: string | number | null;
  name: string;
  position: PositionKey | string;
  number?: number | null;
  shirtNumber?: number | null;
  teamId: string;
  participant: 1 | 2; // 1 = Home, 2 = Away
  starter: boolean;
  officialSubstitute?: boolean;
  stats?: PlayerStats | null;
  impactRating: number | null;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  shotsOnTarget?: number;
}

export interface LiveFixture {
  id: string;
  tournamentName: string;
  startsAt: string;
  status: "UPCOMING" | "LIVE" | "COMPLETED" | "HALF_TIME";
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: string;
  awayTeam: string;
  participant1Id: string;
  participant2Id: string;
  homeScore: number | null;
  awayScore: number | null;
}

export interface SelectedTrio {
  ATT?: LivePlayer;
  MID?: LivePlayer;
  DEF?: LivePlayer;
}

export interface PositionMatchup {
  position: "ATT" | "MID" | "DEF";
  userPlayer: LivePlayer | null;
  oppositionPlayer: LivePlayer | null;
  userRating: number;
  oppositionRating: number;
  winner: "USER" | "OPPOSITION" | "TIE";
}

export interface TrioComparisonSummary {
  matchups: PositionMatchup[];
  userTotalRating: number;
  oppositionTotalRating: number;
  matchIndex: number | null; // (userTotal / oppositionTotal) * 100
  userPositionsWon: number;
  oppositionPositionsWon: number;
}

export type RootStackParamList = {
  Home: undefined;
  CompletedMatch: {
    fixtureId: string;
    fixture?: LiveFixture;
    selectedTeamId: string;
    selectedPlayerIds: string[]; // [ATT_id, MID_id, DEF_id]
  };
  TeamDetail: { teamId: string };
  Support: undefined;
  Players: undefined;
  TeamJourney: { teamId: string; wallet: string };
  Profile: undefined;
};

export type CompletedMatchScreenRouteProp = RouteProp<
  RootStackParamList,
  "CompletedMatch"
>;

export type CompletedMatchScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  "CompletedMatch"
>;

// ─── Journey Types (mobile) ─────────────────────────────────────────────────

export type JourneyStatus = "active" | "eliminated" | "completed";

export interface TeamJourneyCard {
  teamId: string;
  teamName: string;
  teamCode: string;
  flag: string;
  status: JourneyStatus;
  currentStage: string;
  matchesFollowed: number;
  eligibleMatches: number;
  totalJourneyScore: number;
  averageMatchIndex: number | null;
  currentTeamRank: number | null;
  percentile: number | null;
  topFanEligible: boolean;
}

export interface MatchTimelineEntry {
  fixtureId: string;
  stage: string;
  opponent: string;
  opponentFlag: string;
  matchResult: string | null;
  trioNames: [string, string, string] | null;
  finalMatchIndex: number | null;
  rankBefore: number | null;
  rankAfter: number | null;
  status: "completed" | "live" | "upcoming";
  startsAt: string;
}

export interface TrustedPlayerSummary {
  playerId: string;
  playerName: string;
  position: string;
  timesSelected: number;
  averageRatingWhenSelected: number | null;
  supporterPointsGenerated: number;
  bestFixtureId: string | null;
  bestFixtureOpponent: string | null;
}

export interface JourneyLeaderboardEntry {
  rank: number;
  wallet: string;
  displayName: string;
  totalScore: number;
  isCurrentUser: boolean;
}

export interface TeamJourneyPageData {
  journey: TeamJourneyCard;
  timeline: MatchTimelineEntry[];
  trustedPlayers: TrustedPlayerSummary[];
  leaderboard: {
    top: JourneyLeaderboardEntry[];
    user: JourneyLeaderboardEntry | null;
    totalParticipants: number;
    top1PercentCutoff: number | null;
  };
  rankHistory: number[];
}
