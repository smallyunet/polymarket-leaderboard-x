import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type LeaderboardQuery,
  type LeaderboardRow,
  type Profile,
  type SnapshotFile,
  normalizeWallet,
  slugForQuery,
} from "./polymarket.js";

const ROOT = process.cwd();
const SNAPSHOTS_DIR = path.join(ROOT, "data/snapshots");
const PROFILE_CACHE_PATH = path.join(ROOT, "data/cache/profiles.json");
const DERIVED_DIR = path.join(ROOT, "public/data/derived");

type ProfileCache = Record<
  string,
  {
    fetchedAt: string;
    status: number;
    profile: Profile | null;
  }
>;

type Observation = {
  snapshotDate: string;
  query: LeaderboardQuery;
  rank: number | null;
  proxyWallet: string;
  userName: string | null;
  vol: number | null;
  pnl: number | null;
  profileImage: string | null;
  xUsername: string | null;
  verifiedBadge: boolean | null;
};

type TraderSummary = {
  wallet: string;
  userName: string | null;
  xUsername: string | null;
  verifiedBadge: boolean | null;
  profileImage: string | null;
  profileName: string | null;
  profileBio: string | null;
  firstSeen: string;
  lastSeen: string;
  daysSeen: number;
  appearances: number;
  currentBestRank: number | null;
  previousBestRank: number | null;
  rankChange: number | null;
  bestRankAllTime: number | null;
  top10Count: number;
  top50Count: number;
  top100Count: number;
  categories: string[];
  timePeriods: string[];
  orderBy: string[];
  tags: string[];
};

type LatestLeaderboard = {
  key: string;
  query: LeaderboardQuery;
  snapshotDate: string;
  rows: Observation[];
};

function parseRank(value: LeaderboardRow["rank"]): number | null {
  const rank = Number(value);
  return Number.isFinite(rank) ? rank : null;
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function listSnapshotFiles(): Promise<string[]> {
  let dates: string[];
  try {
    dates = await readdir(SNAPSHOTS_DIR);
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const date of dates.sort()) {
    const dateDir = path.join(SNAPSHOTS_DIR, date);
    const children = await readdir(dateDir);
    for (const child of children) {
      if (child.endsWith(".json") && child !== "manifest.json") {
        files.push(path.join(dateDir, child));
      }
    }
  }
  return files;
}

function flatten(snapshot: SnapshotFile): Observation[] {
  return snapshot.pages.flatMap((page) =>
    page.rows.map((row) => ({
      snapshotDate: snapshot.snapshotDate,
      query: snapshot.query,
      rank: parseRank(row.rank),
      proxyWallet: row.proxyWallet,
      userName: row.userName ?? null,
      vol: row.vol ?? null,
      pnl: row.pnl ?? null,
      profileImage: row.profileImage ?? null,
      xUsername: row.xUsername ?? null,
      verifiedBadge: row.verifiedBadge ?? null,
    })),
  );
}

function bestRank(observations: Observation[]): number | null {
  const ranks = observations.map((item) => item.rank).filter((rank): rank is number => rank !== null);
  return ranks.length > 0 ? Math.min(...ranks) : null;
}

function latestValue<T>(observations: Observation[], selector: (item: Observation) => T | null | undefined): T | null {
  for (const observation of [...observations].reverse()) {
    const value = selector(observation);
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function buildTags(summary: Omit<TraderSummary, "tags">, observations: Observation[]): string[] {
  const tags = new Set<string>();
  if (summary.xUsername) tags.add("x-linked");
  if (summary.verifiedBadge) tags.add("verified");
  if (summary.bestRankAllTime !== null && summary.bestRankAllTime <= 10) tags.add("top-10");
  if (summary.bestRankAllTime !== null && summary.bestRankAllTime <= 50) tags.add("top-50");
  if (summary.daysSeen >= 7) tags.add("consistent");
  if (summary.categories.length >= 3) tags.add("multi-category");
  if (summary.orderBy.includes("VOL") && observations.filter((item) => item.query.orderBy === "VOL").length > observations.length / 2) {
    tags.add("high-volume");
  }
  if (summary.orderBy.includes("PNL") && observations.filter((item) => item.query.orderBy === "PNL").length > observations.length / 2) {
    tags.add("high-pnl");
  }
  if (summary.rankChange !== null && summary.rankChange <= -25) tags.add("rising-fast");
  if (summary.rankChange !== null && summary.rankChange >= 25) tags.add("falling-fast");

  const categoryCounts = new Map<string, number>();
  for (const observation of observations) {
    categoryCounts.set(observation.query.category, (categoryCounts.get(observation.query.category) ?? 0) + 1);
  }
  for (const [category, count] of categoryCounts.entries()) {
    if (category !== "OVERALL" && count >= Math.max(3, observations.length * 0.25)) {
      tags.add(`${category.toLowerCase()}-heavy`);
    }
  }

  return [...tags].sort();
}

async function main(): Promise<void> {
  const files = await listSnapshotFiles();
  const profileCache = await readJson<ProfileCache>(PROFILE_CACHE_PATH, {});
  const snapshots = await Promise.all(files.map((file) => readJson<SnapshotFile | null>(file, null)));
  const validSnapshots = snapshots.filter((snapshot): snapshot is SnapshotFile => Boolean(snapshot));
  const observations = validSnapshots.flatMap(flatten).filter((item) => item.proxyWallet);
  const dates = uniqueSorted(observations.map((item) => item.snapshotDate));
  const latestDate = dates.at(-1) ?? null;
  const previousDate = dates.length >= 2 ? dates.at(-2)! : null;

  await mkdir(DERIVED_DIR, { recursive: true });

  const latestLeaderboards: LatestLeaderboard[] = validSnapshots
    .filter((snapshot) => snapshot.snapshotDate === latestDate)
    .map((snapshot) => ({
      key: slugForQuery(snapshot.query),
      query: snapshot.query,
      snapshotDate: snapshot.snapshotDate,
      rows: flatten(snapshot),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const byWallet = new Map<string, Observation[]>();
  for (const observation of observations) {
    const key = normalizeWallet(observation.proxyWallet);
    const list = byWallet.get(key) ?? [];
    list.push(observation);
    byWallet.set(key, list);
  }

  const traders: TraderSummary[] = [...byWallet.entries()].map(([walletKey, items]) => {
    items.sort((a, b) => `${a.snapshotDate}:${a.query.category}:${a.query.timePeriod}:${a.query.orderBy}:${a.rank}`.localeCompare(`${b.snapshotDate}:${b.query.category}:${b.query.timePeriod}:${b.query.orderBy}:${b.rank}`));
    const profile = profileCache[walletKey]?.profile ?? null;
    const latestItems = latestDate ? items.filter((item) => item.snapshotDate === latestDate) : [];
    const previousItems = previousDate ? items.filter((item) => item.snapshotDate === previousDate) : [];
    const currentBestRank = latestItems.length > 0 ? bestRank(latestItems) : null;
    const previousBestRank = previousItems.length > 0 ? bestRank(previousItems) : null;
    const partial = {
      wallet: latestValue(items, (item) => item.proxyWallet) ?? walletKey,
      userName: latestValue(items, (item) => item.userName),
      xUsername: latestValue(items, (item) => item.xUsername) ?? profile?.xUsername ?? null,
      verifiedBadge: latestValue(items, (item) => item.verifiedBadge) ?? profile?.verifiedBadge ?? null,
      profileImage: latestValue(items, (item) => item.profileImage) ?? profile?.profileImage ?? null,
      profileName: profile?.name ?? profile?.pseudonym ?? null,
      profileBio: profile?.bio ?? null,
      firstSeen: uniqueSorted(items.map((item) => item.snapshotDate))[0],
      lastSeen: uniqueSorted(items.map((item) => item.snapshotDate)).at(-1)!,
      daysSeen: uniqueSorted(items.map((item) => item.snapshotDate)).length,
      appearances: items.length,
      currentBestRank,
      previousBestRank,
      rankChange: currentBestRank !== null && previousBestRank !== null ? currentBestRank - previousBestRank : null,
      bestRankAllTime: bestRank(items),
      top10Count: items.filter((item) => item.rank !== null && item.rank <= 10).length,
      top50Count: items.filter((item) => item.rank !== null && item.rank <= 50).length,
      top100Count: items.filter((item) => item.rank !== null && item.rank <= 100).length,
      categories: uniqueSorted(items.map((item) => item.query.category)),
      timePeriods: uniqueSorted(items.map((item) => item.query.timePeriod)),
      orderBy: uniqueSorted(items.map((item) => item.query.orderBy)),
    };
    return {
      ...partial,
      tags: buildTags(partial, items),
    };
  });

  traders.sort((a, b) => {
    if (a.xUsername && !b.xUsername) return -1;
    if (!a.xUsername && b.xUsername) return 1;
    return (a.bestRankAllTime ?? Number.MAX_SAFE_INTEGER) - (b.bestRankAllTime ?? Number.MAX_SAFE_INTEGER);
  });

  const xLinkedTraders = traders.filter((trader) => trader.xUsername);
  const tagIndex = traders.reduce<Record<string, number>>((acc, trader) => {
    for (const tag of trader.tags) acc[tag] = (acc[tag] ?? 0) + 1;
    return acc;
  }, {});

  const summary = {
    generatedAt: new Date().toISOString(),
    latestDate,
    previousDate,
    snapshotDates: dates,
    snapshotFileCount: validSnapshots.length,
    observationCount: observations.length,
    traderCount: traders.length,
    xLinkedTraderCount: xLinkedTraders.length,
    latestLeaderboardCount: latestLeaderboards.length,
  };

  await writeFile(path.join(DERIVED_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(DERIVED_DIR, "latest-leaderboards.json"), `${JSON.stringify(latestLeaderboards, null, 2)}\n`);
  await writeFile(path.join(DERIVED_DIR, "traders.json"), `${JSON.stringify(traders, null, 2)}\n`);
  await writeFile(path.join(DERIVED_DIR, "x-linked-traders.json"), `${JSON.stringify(xLinkedTraders, null, 2)}\n`);
  await writeFile(path.join(DERIVED_DIR, "tag-index.json"), `${JSON.stringify(tagIndex, null, 2)}\n`);
  console.log(`Derived ${traders.length} traders, ${xLinkedTraders.length} X-linked traders`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
