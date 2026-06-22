import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { ArrowDown, ArrowUp, ExternalLink, Filter, Search, Twitter } from "lucide-react";
import "./styles.css";

type Summary = {
  generatedAt: string;
  latestDate: string | null;
  previousDate: string | null;
  snapshotDates: string[];
  snapshotFileCount: number;
  observationCount: number;
  traderCount: number;
  xLinkedTraderCount: number;
  latestLeaderboardCount: number;
};

type Trader = {
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
  query: {
    category: string;
    timePeriod: string;
    orderBy: string;
  };
  snapshotDate: string;
  rows: Array<{
    rank: number | null;
    proxyWallet: string;
    userName: string | null;
    vol: number | null;
    pnl: number | null;
    xUsername: string | null;
    verifiedBadge: boolean | null;
  }>;
};

function useJson<T>(path: string, fallback: T): T {
  const [data, setData] = useState<T>(fallback);

  useEffect(() => {
    let alive = true;
    fetch(path)
      .then((response) => (response.ok ? response.json() : fallback))
      .then((json) => {
        if (alive) setData(json as T);
      })
      .catch(() => {
        if (alive) setData(fallback);
      });
    return () => {
      alive = false;
    };
  }, [path]);

  return data;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function shortWallet(wallet: string): string {
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function rankDelta(delta: number | null): ReactElement {
  if (delta === null || delta === 0) return <span className="muted">-</span>;
  const improved = delta < 0;
  return (
    <span className={improved ? "delta up" : "delta down"}>
      {improved ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
      {Math.abs(delta)}
    </span>
  );
}

function App() {
  const summary = useJson<Summary>("data/derived/summary.json", {
    generatedAt: "",
    latestDate: null,
    previousDate: null,
    snapshotDates: [],
    snapshotFileCount: 0,
    observationCount: 0,
    traderCount: 0,
    xLinkedTraderCount: 0,
    latestLeaderboardCount: 0,
  });
  const traders = useJson<Trader[]>("data/derived/x-linked-traders.json", []);
  const latestLeaderboards = useJson<LatestLeaderboard[]>("data/derived/latest-leaderboards.json", []);
  const tagIndex = useJson<Record<string, number>>("data/derived/tag-index.json", {});

  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("all");
  const [leaderboardKey, setLeaderboardKey] = useState("");

  const selectedLeaderboard = useMemo(() => {
    if (!latestLeaderboards.length) return null;
    return latestLeaderboards.find((item) => item.key === leaderboardKey) ?? latestLeaderboards[0];
  }, [latestLeaderboards, leaderboardKey]);

  const filteredTraders = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return traders.filter((trader) => {
      const matchesTag = tag === "all" || trader.tags.includes(tag);
      const matchesQuery =
        normalized.length === 0 ||
        trader.wallet.toLowerCase().includes(normalized) ||
        trader.userName?.toLowerCase().includes(normalized) ||
        trader.xUsername?.toLowerCase().includes(normalized) ||
        trader.tags.some((item) => item.includes(normalized));
      return matchesTag && matchesQuery;
    });
  }, [query, tag, traders]);

  const topTags = Object.entries(tagIndex)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  return (
    <main>
      <section className="hero">
        <div>
          <p className="eyebrow">Polymarket leaderboard intelligence</p>
          <h1>X-linked trader tracker</h1>
          <p className="subtle">
            Daily snapshots across every documented category, time period, ordering mode, and pagination window.
          </p>
        </div>
        <div className="stats">
          <Metric label="Latest snapshot" value={summary.latestDate ?? "No data"} />
          <Metric label="X-linked wallets" value={formatNumber(summary.xLinkedTraderCount)} />
          <Metric label="Leaderboard files" value={formatNumber(summary.snapshotFileCount)} />
          <Metric label="Rows observed" value={formatNumber(summary.observationCount)} />
        </div>
      </section>

      <section className="toolbar">
        <label className="search">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search wallet, X, username, tag" />
        </label>
        <label className="selectWrap">
          <Filter size={18} />
          <select value={tag} onChange={(event) => setTag(event.target.value)}>
            <option value="all">All tags</option>
            {topTags.map(([tagName, count]) => (
              <option key={tagName} value={tagName}>
                {tagName} ({count})
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="grid">
        <div className="panel wide">
          <div className="panelHeader">
            <div>
              <h2>X-linked wallets</h2>
              <p>{filteredTraders.length} visible traders</p>
            </div>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Trader</th>
                  <th>X</th>
                  <th>Best</th>
                  <th>Change</th>
                  <th>Seen</th>
                  <th>Tags</th>
                </tr>
              </thead>
              <tbody>
                {filteredTraders.slice(0, 200).map((trader) => (
                  <tr key={trader.wallet}>
                    <td>
                      <div className="identity">
                        {trader.profileImage ? <img src={trader.profileImage} alt="" /> : <div className="avatar">{(trader.userName ?? "?").slice(0, 1)}</div>}
                        <div>
                          <strong>{trader.userName ?? trader.profileName ?? "Unnamed"}</strong>
                          <a href={`https://polymarket.com/profile/${trader.wallet}`} target="_blank" rel="noreferrer">
                            {shortWallet(trader.wallet)}
                          </a>
                        </div>
                      </div>
                    </td>
                    <td>
                      {trader.xUsername ? (
                        <a className="xLink" href={`https://x.com/${trader.xUsername}`} target="_blank" rel="noreferrer">
                          <Twitter size={15} />@{trader.xUsername}
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>#{trader.bestRankAllTime ?? "-"}</td>
                    <td>{rankDelta(trader.rankChange)}</td>
                    <td>{trader.daysSeen}d</td>
                    <td>
                      <div className="tags">
                        {trader.tags.slice(0, 4).map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader">
            <div>
              <h2>Latest leaderboard</h2>
              <p>{selectedLeaderboard?.snapshotDate ?? "No snapshot"}</p>
            </div>
          </div>
          <select className="fullSelect" value={selectedLeaderboard?.key ?? ""} onChange={(event) => setLeaderboardKey(event.target.value)}>
            {latestLeaderboards.map((leaderboard) => (
              <option key={leaderboard.key} value={leaderboard.key}>
                {leaderboard.query.category} / {leaderboard.query.timePeriod} / {leaderboard.query.orderBy}
              </option>
            ))}
          </select>
          <div className="leaderRows">
            {(selectedLeaderboard?.rows ?? []).slice(0, 25).map((row) => (
              <a className="leaderRow" key={`${row.proxyWallet}-${row.rank}`} href={`https://polymarket.com/profile/${row.proxyWallet}`} target="_blank" rel="noreferrer">
                <span>#{row.rank ?? "-"}</span>
                <strong>{row.userName ?? shortWallet(row.proxyWallet)}</strong>
                <em>{row.xUsername ? `@${row.xUsername}` : shortWallet(row.proxyWallet)}</em>
                <ExternalLink size={14} />
              </a>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
