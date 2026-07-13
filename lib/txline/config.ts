export const TXLINE = {
  apiBase: "https://txline-dev.txodds.com/api",
  guestAuth: "https://txline-dev.txodds.com/auth/guest/start",
  rpc: "https://api.devnet.solana.com",
  programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
  tokenMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
  serviceLevelId: 1,
  durationWeeks: 4,
  leagues: [] as number[],
} as const;

export const TXLINE_JWT_COOKIE = "txline_dev_jwt";
export const TXLINE_API_TOKEN_COOKIE = "txline_dev_api_token";

