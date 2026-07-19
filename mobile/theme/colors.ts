export const COLORS = {
  // Base background & surfaces (Off-white scheme)
  background: "#F5F3EC",
  surface: "#FFFFFF",
  surfaceElevated: "#FFFFFF",
  card: "#FFFFFF",
  cardHover: "#EDEDE7",

  // Borders & overlays
  border: "#DEDDD5",
  borderActive: "#153D2E",
  glassBg: "rgba(0, 0, 0, 0.02)",
  glassBorder: "rgba(0, 0, 0, 0.08)",

  // Brand & Accent Colors
  primary: "#153D2E",       // Dark green primary
  primaryMuted: "rgba(21, 61, 46, 0.08)",
  secondary: "#74776F",     // Charcoal/muted gray
  accentGold: "#E8A30E",     // Amber
  successGreen: "#2D653D",  // Clean positive green
  warningAmber: "#E8A30E",  // Amber warnings

  // Typography (Charcoal theme)
  textPrimary: "#131713",
  textSecondary: "#74776F",
  textMuted: "#96978F",

  // Ratings Semantic Colors
  ratingHigh: "#2D653D",    // 7.5+
  ratingMid: "#E8A30E",     // 6.5 - 7.4
  ratingAverage: "#74776F", // 5.8 - 6.4
  ratingLow: "#FF5252",     // < 5.8

  // Status Colors
  liveText: "#2D653D",
  livePulse: "rgba(45, 101, 61, 0.15)",
  completedText: "#74776F",
  completedBg: "#EDEDE7",
};

export function getRatingColor(rating: number | null | undefined): string {
  if (rating === null || rating === undefined) return COLORS.textMuted;
  if (rating >= 7.5) return COLORS.ratingHigh;
  if (rating >= 6.5) return COLORS.ratingMid;
  if (rating >= 5.8) return COLORS.ratingAverage;
  return COLORS.ratingLow;
}

export function getPositionColors(pos: string) {
  // Neutral layout styling for all position chips
  return { bg: "#EDEDE7", text: "#131713" };
}

