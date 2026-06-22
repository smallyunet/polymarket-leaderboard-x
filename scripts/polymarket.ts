export const CATEGORIES = [
  "OVERALL",
  "POLITICS",
  "SPORTS",
  "ESPORTS",
  "CRYPTO",
  "CULTURE",
  "MENTIONS",
  "WEATHER",
  "ECONOMICS",
  "TECH",
  "FINANCE",
] as const;

export const TIME_PERIODS = ["DAY", "WEEK", "MONTH", "ALL"] as const;

export const ORDER_BY = ["PNL", "VOL"] as const;

export const LEADERBOARD_LIMIT = 50;
export const MAX_OFFSET = 1000;

export type Category = (typeof CATEGORIES)[number];
export type TimePeriod = (typeof TIME_PERIODS)[number];
export type OrderBy = (typeof ORDER_BY)[number];

export type LeaderboardQuery = {
  category: Category;
  timePeriod: TimePeriod;
  orderBy: OrderBy;
};

export type LeaderboardRow = {
  rank: string | number;
  proxyWallet: string;
  userName?: string | null;
  vol?: number | null;
  pnl?: number | null;
  profileImage?: string | null;
  xUsername?: string | null;
  verifiedBadge?: boolean | null;
};

export type Profile = {
  createdAt?: string | null;
  proxyWallet?: string | null;
  profileImage?: string | null;
  displayUsernamePublic?: boolean | null;
  bio?: string | null;
  pseudonym?: string | null;
  name?: string | null;
  users?: Array<{ id?: string; creator?: boolean; mod?: boolean }> | null;
  xUsername?: string | null;
  verifiedBadge?: boolean | null;
};

export type SnapshotFile = {
  snapshotDate: string;
  fetchedAt: string;
  source: "polymarket-data-api";
  query: LeaderboardQuery;
  limit: number;
  pages: Array<{
    offset: number;
    count: number;
    rows: LeaderboardRow[];
  }>;
};

export function matrix(): LeaderboardQuery[] {
  const output: LeaderboardQuery[] = [];
  for (const category of CATEGORIES) {
    for (const timePeriod of TIME_PERIODS) {
      for (const orderBy of ORDER_BY) {
        output.push({ category, timePeriod, orderBy });
      }
    }
  }
  return output;
}

export function slugForQuery(query: LeaderboardQuery): string {
  return `${query.category}_${query.timePeriod}_${query.orderBy}`;
}

export function normalizeWallet(wallet: string): string {
  return wallet.toLowerCase();
}
