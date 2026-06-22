import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CATEGORIES,
  LEADERBOARD_LIMIT,
  MAX_OFFSET,
  ORDER_BY,
  TIME_PERIODS,
  type Category,
  type LeaderboardQuery,
  type LeaderboardRow,
  type Profile,
  type SnapshotFile,
  matrix,
  normalizeWallet,
  slugForQuery,
} from "./polymarket.js";

const DATA_API = "https://data-api.polymarket.com/v1/leaderboard";
const PROFILE_API = "https://gamma-api.polymarket.com/public-profile";
const ROOT = process.cwd();
const PROFILE_CACHE_PATH = path.join(ROOT, "data/cache/profiles.json");

type ProfileCache = Record<
  string,
  {
    fetchedAt: string;
    status: number;
    profile: Profile | null;
  }
>;

type FetchOptions = {
  concurrency: number;
  profileConcurrency: number;
  maxOffset: number;
  snapshotDate: string;
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function csvEnv<T extends string>(name: string, allowed: readonly T[]): T[] {
  const raw = process.env[name];
  if (!raw) return [...allowed];
  const requested = raw
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
  const allowedSet = new Set<string>(allowed);
  const invalid = requested.filter((value) => !allowedSet.has(value));
  if (invalid.length > 0) {
    throw new Error(`${name} contains unsupported values: ${invalid.join(", ")}`);
  }
  return requested as T[];
}

function selectedMatrix(): LeaderboardQuery[] {
  const categories = csvEnv("PM_CATEGORIES", CATEGORIES);
  const timePeriods = csvEnv("PM_TIME_PERIODS", TIME_PERIODS);
  const orderByValues = csvEnv("PM_ORDER_BY", ORDER_BY);
  return matrix().filter(
    (query) =>
      categories.includes(query.category) &&
      timePeriods.includes(query.timePeriod) &&
      orderByValues.includes(query.orderBy),
  );
}

function parseOptions(): FetchOptions {
  const maxOffset = Number(process.env.PM_MAX_OFFSET ?? MAX_OFFSET);
  if (!Number.isInteger(maxOffset) || maxOffset < 0 || maxOffset > MAX_OFFSET || maxOffset % LEADERBOARD_LIMIT !== 0) {
    throw new Error(`PM_MAX_OFFSET must be a multiple of ${LEADERBOARD_LIMIT} between 0 and ${MAX_OFFSET}`);
  }

  return {
    concurrency: Number(process.env.PM_CONCURRENCY ?? 8),
    profileConcurrency: Number(process.env.PM_PROFILE_CONCURRENCY ?? 12),
    maxOffset,
    snapshotDate: process.env.SNAPSHOT_DATE ?? todayUtc(),
  };
}

async function fetchJson<T>(url: URL, attempt = 1): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "polymarket-leaderboard-x/0.1",
    },
  });

  if (!response.ok) {
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      await wait(500 * attempt * attempt);
      return fetchJson<T>(url, attempt + 1);
    }
    throw new Error(`GET ${url.toString()} failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function fetchLeaderboard(query: LeaderboardQuery, options: FetchOptions): Promise<SnapshotFile> {
  const pages: SnapshotFile["pages"] = [];

  for (let offset = 0; offset <= options.maxOffset; offset += LEADERBOARD_LIMIT) {
    const url = new URL(DATA_API);
    url.searchParams.set("category", query.category);
    url.searchParams.set("timePeriod", query.timePeriod);
    url.searchParams.set("orderBy", query.orderBy);
    url.searchParams.set("limit", String(LEADERBOARD_LIMIT));
    url.searchParams.set("offset", String(offset));

    const rows = await fetchJson<LeaderboardRow[]>(url);
    pages.push({ offset, count: rows.length, rows });

    if (rows.length < LEADERBOARD_LIMIT) break;
  }

  return {
    snapshotDate: options.snapshotDate,
    fetchedAt: new Date().toISOString(),
    source: "polymarket-data-api",
    query,
    limit: LEADERBOARD_LIMIT,
    pages,
  };
}

async function readProfileCache(): Promise<ProfileCache> {
  try {
    return JSON.parse(await readFile(PROFILE_CACHE_PATH, "utf8")) as ProfileCache;
  } catch {
    return {};
  }
}

function shouldRefreshProfile(entry: ProfileCache[string] | undefined): boolean {
  if (!entry) return true;
  if (entry.status === 404) return false;
  const ageMs = Date.now() - new Date(entry.fetchedAt).getTime();
  return ageMs > 7 * 24 * 60 * 60 * 1000;
}

async function fetchProfile(wallet: string): Promise<ProfileCache[string]> {
  const url = new URL(PROFILE_API);
  url.searchParams.set("address", wallet);

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "polymarket-leaderboard-x/0.1",
    },
  });

  if (response.status === 404) {
    return { fetchedAt: new Date().toISOString(), status: 404, profile: null };
  }

  if (!response.ok) {
    throw new Error(`GET ${url.toString()} failed with ${response.status}`);
  }

  return {
    fetchedAt: new Date().toISOString(),
    status: response.status,
    profile: (await response.json()) as Profile,
  };
}

async function main(): Promise<void> {
  const options = parseOptions();
  const queries = selectedMatrix();
  const snapshotDir = path.join(ROOT, "data/snapshots", options.snapshotDate);

  await mkdir(snapshotDir, { recursive: true });
  await mkdir(path.dirname(PROFILE_CACHE_PATH), { recursive: true });

  console.log(`Collecting ${queries.length} leaderboard combinations for ${options.snapshotDate}`);

  const snapshots = await mapLimit(queries, options.concurrency, async (query, index) => {
    const snapshot = await fetchLeaderboard(query, options);
    const filePath = path.join(snapshotDir, `${slugForQuery(query)}.json`);
    await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`);
    const rowCount = snapshot.pages.reduce((sum, page) => sum + page.count, 0);
    console.log(`[${index + 1}/${queries.length}] ${slugForQuery(query)}: ${rowCount} rows`);
    return snapshot;
  });

  const wallets = new Map<string, { wallet: string; hasXInLeaderboard: boolean }>();
  for (const snapshot of snapshots) {
    for (const page of snapshot.pages) {
      for (const row of page.rows) {
        if (!row.proxyWallet) continue;
        const key = normalizeWallet(row.proxyWallet);
        const previous = wallets.get(key);
        wallets.set(key, {
          wallet: row.proxyWallet,
          hasXInLeaderboard: Boolean(previous?.hasXInLeaderboard || row.xUsername),
        });
      }
    }
  }

  const profileCache = await readProfileCache();
  const profileMode = process.env.PM_PROFILE_MODE ?? "x-only";
  const profileWallets = [...wallets.entries()]
    .filter(([key, value]) => {
      if (profileMode === "off") return false;
      if (profileMode === "x-only" && !value.hasXInLeaderboard) return false;
      return shouldRefreshProfile(profileCache[key]);
    })
    .map(([_, value]) => value.wallet);

  console.log(`Refreshing ${profileWallets.length} public profiles`);

  await mapLimit(profileWallets, options.profileConcurrency, async (wallet, index) => {
    const key = normalizeWallet(wallet);
    try {
      profileCache[key] = await fetchProfile(wallet);
    } catch (error) {
      console.warn(`Profile refresh failed for ${wallet}: ${(error as Error).message}`);
    }
    if ((index + 1) % 100 === 0 || index + 1 === profileWallets.length) {
      console.log(`Profiles: ${index + 1}/${profileWallets.length}`);
    }
  });

  await writeFile(PROFILE_CACHE_PATH, `${JSON.stringify(profileCache, null, 2)}\n`);

  const manifest = {
    snapshotDate: options.snapshotDate,
    fetchedAt: new Date().toISOString(),
    queryCount: queries.length,
    maxOffset: options.maxOffset,
    categories: [...new Set(queries.map((query) => query.category))] as Category[],
    timePeriods: [...new Set(queries.map((query) => query.timePeriod))],
    orderBy: [...new Set(queries.map((query) => query.orderBy))],
    files: queries.map((query) => `${slugForQuery(query)}.json`),
  };

  await writeFile(path.join(snapshotDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("Collection complete");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
