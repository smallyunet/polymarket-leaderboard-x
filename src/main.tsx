import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { 
  ArrowDown, 
  ArrowUp, 
  BarChart3, 
  ChevronLeft, 
  ChevronRight, 
  ExternalLink, 
  Filter, 
  Search, 
  UsersRound, 
  Sun, 
  Moon, 
  Copy, 
  Check, 
  Download, 
  X, 
  Info 
} from "lucide-react";
import "./styles.css";

const TRADERS_PER_PAGE = 200;

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
  leaderboards?: string[];
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
  if (!wallet) return "";
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function rankDelta(delta: number | null): ReactElement {
  if (delta === null || delta === 0) return <span className="muted">-</span>;
  const improved = delta < 0;
  return (
    <span className={improved ? "delta up" : "delta down"}>
      {improved ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
      {Math.abs(delta)}
    </span>
  );
}

function formatDateTime(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function sourceLabels(trader: Trader): string[] {
  if (trader.leaderboards?.length) return trader.leaderboards;
  const labels = new Set<string>();
  for (const category of trader.categories) {
    for (const timePeriod of trader.timePeriods) {
      for (const orderBy of trader.orderBy) {
        labels.add(`${category} / ${timePeriod} / ${orderBy}`);
      }
    }
  }
  return [...labels].sort();
}

function highlightText(text: string | null | undefined, search: string) {
  if (!text) return "";
  if (!search.trim()) return text;
  const regex = new RegExp(`(${search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, index) => 
        regex.test(part) ? <mark key={index} className="search-highlight">{part}</mark> : part
      )}
    </>
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
  const [traderPage, setTraderPage] = useState(1);
  
  // Custom theme selector state
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  // Sorting state
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Drawer selected trader profile state
  const [selectedTrader, setSelectedTrader] = useState<Trader | null>(null);
  const [copiedWallet, setCopiedWallet] = useState(false);

  // Sync theme selection to document element
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const selectedLeaderboard = useMemo(() => {
    if (!latestLeaderboards.length) return null;
    return latestLeaderboards.find((item) => item.key === leaderboardKey) ?? latestLeaderboards[0];
  }, [latestLeaderboards, leaderboardKey]);

  // Filter logic
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

  // Sorting logic on filtered traders
  const sortedTraders = useMemo(() => {
    if (!sortField) return filteredTraders;

    return [...filteredTraders].sort((a, b) => {
      let aVal: any = null;
      let bVal: any = null;

      if (sortField === "trader") {
        aVal = a.userName ?? a.profileName ?? "";
        bVal = b.userName ?? b.profileName ?? "";
      } else if (sortField === "xUsername") {
        aVal = a.xUsername ?? "";
        bVal = b.xUsername ?? "";
      } else if (sortField === "bestRank") {
        aVal = a.bestRankAllTime;
        bVal = b.bestRankAllTime;
      } else if (sortField === "rankChange") {
        aVal = a.rankChange;
        bVal = b.rankChange;
      } else if (sortField === "daysSeen") {
        aVal = a.daysSeen;
        bVal = b.daysSeen;
      } else if (sortField === "top10Count") {
        aVal = a.top10Count;
        bVal = b.top10Count;
      }

      // Handle null/undefined values to always place them at the end
      if (aVal === null || aVal === undefined) return sortOrder === "asc" ? 1 : -1;
      if (bVal === null || bVal === undefined) return sortOrder === "asc" ? -1 : 1;

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortOrder === "asc" 
          ? aVal.localeCompare(bVal) 
          : bVal.localeCompare(aVal);
      }

      return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
    });
  }, [filteredTraders, sortField, sortOrder]);

  useEffect(() => {
    setTraderPage(1);
  }, [query, tag]);

  const traderPageCount = Math.max(1, Math.ceil(sortedTraders.length / TRADERS_PER_PAGE));

  useEffect(() => {
    setTraderPage((page) => Math.min(page, traderPageCount));
  }, [traderPageCount]);

  const traderPageStart = (traderPage - 1) * TRADERS_PER_PAGE;
  const visibleTraders = sortedTraders.slice(traderPageStart, traderPageStart + TRADERS_PER_PAGE);
  const traderDisplayStart = sortedTraders.length === 0 ? 0 : traderPageStart + 1;
  const traderPageEnd = traderPageStart + visibleTraders.length;

  const topTags = useMemo(() => {
    return Object.entries(tagIndex)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
  }, [tagIndex]);

  const totalTags = Object.keys(tagIndex).length;
  const selectedLabel = selectedLeaderboard
    ? `${selectedLeaderboard.query.category} / ${selectedLeaderboard.query.timePeriod} / ${selectedLeaderboard.query.orderBy}`
    : "No leaderboard selected";

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const handleTagClick = (tagName: string) => {
    setTag((prev) => (prev === tagName ? "all" : tagName));
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      if (sortOrder === "asc") {
        setSortOrder("desc");
      } else {
        setSortField(null);
      }
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const handleCopyWallet = (walletAddress: string) => {
    navigator.clipboard.writeText(walletAddress);
    setCopiedWallet(true);
    setTimeout(() => setCopiedWallet(false), 2000);
  };

  const handleExportData = () => {
    const csvRows = [
      ["Wallet", "Username", "X Handle", "Best Rank All Time", "Days Seen", "Top 10 Count", "Tags"].join(",")
    ];

    sortedTraders.forEach(t => {
      csvRows.push([
        t.wallet,
        `"${(t.userName ?? t.profileName ?? "Unnamed").replace(/"/g, '""')}"`,
        t.xUsername ? `@${t.xUsername}` : "",
        t.bestRankAllTime ?? "",
        t.daysSeen,
        t.top10Count,
        `"${t.tags.join("; ")}"`
      ].join(","));
    });

    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `x_linked_traders_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderSortHeader = (label: string, field: string) => {
    const isSorted = sortField === field;
    return (
      <th 
        onClick={() => handleSort(field)} 
        className={`sortable-th ${isSorted ? "sorted" : ""}`}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        <div className="th-content">
          <span>{label}</span>
          <span className="sort-icon-container">
            {isSorted ? (
              sortOrder === "asc" ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />
            ) : (
              <ArrowUp size={12} className="inactive-sort" aria-hidden="true" />
            )}
          </span>
        </div>
      </th>
    );
  };

  return (
    <main>
      <header className="topbar" aria-label="Page summary">
        <a className="brand" href="/">
          <BarChart3 size={22} className="brand-logo" aria-hidden="true" />
          <span>Polymarket Leaderboard X</span>
        </a>
        <div className="statusLine">
          <span className="badge-pill">{summary.snapshotDates.length} snapshot days</span>
          <span className="badge-pill">Updated {formatDateTime(summary.generatedAt)}</span>
          <button 
            type="button" 
            className="icon-button theme-toggle" 
            onClick={toggleTheme} 
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="heroCopy">
          <p className="eyebrow">Polymarket leaderboard intelligence</p>
          <h1>X-linked trader tracker</h1>
          <p className="subtle">
            Daily snapshots across every documented category, time period, ordering mode, and pagination window. Keep track of top minds on Polymarket linked to Twitter profiles.
          </p>
          <div className="heroBadges" aria-label="Dataset coverage">
            <span>{formatNumber(summary.traderCount)} total traders</span>
            <span>{formatNumber(totalTags)} behavioral tags</span>
            <span>{formatNumber(summary.latestLeaderboardCount)} latest boards</span>
          </div>
        </div>
        <div className="stats">
          <Metric label="Latest snapshot" value={summary.latestDate ?? "No data"} />
          <Metric label="X-linked wallets" value={formatNumber(summary.xLinkedTraderCount)} />
          <Metric label="Leaderboard files" value={formatNumber(summary.snapshotFileCount)} />
          <Metric label="Rows observed" value={formatNumber(summary.observationCount)} />
        </div>
      </section>

      {/* Toolbar filters */}
      <section className="toolbar" aria-label="Trader filters">
        <div className="fieldGroup searchGroup">
          <label htmlFor="trader-search">Search traders</label>
          <div className="control">
            <Search size={18} aria-hidden="true" />
            <input
              id="trader-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Wallet, X handle, username, or tag..."
            />
            {query && (
              <button 
                type="button" 
                className="clear-search-btn" 
                onClick={() => setQuery("")}
                aria-label="Clear search query"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="fieldGroup">
          <label htmlFor="tag-filter">Tag filter</label>
          <div className="control">
            <Filter size={18} aria-hidden="true" />
            <select id="tag-filter" value={tag} onChange={(event) => setTag(event.target.value)}>
              <option value="all">All tags</option>
              {topTags.map(([tagName, count]) => (
                <option key={tagName} value={tagName}>
                  {tagName} ({count})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="toolbar-actions">
          <button 
            type="button" 
            className="btn btn-secondary export-btn" 
            onClick={handleExportData}
            title="Export filtered list to CSV"
          >
            <Download size={16} aria-hidden="true" />
            <span>Export CSV</span>
          </button>
          <div className="resultPill" aria-live="polite">
            <UsersRound size={17} aria-hidden="true" />
            <strong>{formatNumber(sortedTraders.length)}</strong>
            <span>traders</span>
          </div>
        </div>
      </section>

      {/* Tag Quick Chips horizontal scroller */}
      <section className="chips-scroller-wrapper" aria-label="Quick tags">
        <div className="tags-chips-container">
          <button 
            type="button" 
            onClick={() => setTag("all")} 
            className={`tag-chip ${tag === "all" ? "active" : ""}`}
          >
            All Tags
          </button>
          {topTags.map(([tagName, count]) => (
            <button 
              key={tagName} 
              type="button" 
              onClick={() => handleTagClick(tagName)} 
              className={`tag-chip ${tag === tagName ? "active" : ""}`}
            >
              #{tagName} <span className="chip-count">{count}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="grid">
        {/* Left Panel: Table of X-linked wallets */}
        <div className="panel wide">
          <div className="panelHeader">
            <div>
              <h2>X-linked wallets</h2>
              <p>Click on any trader to open their details drawer. Click columns to sort.</p>
            </div>
            <span className="panelCount">
              {formatNumber(visibleTraders.length)} of {formatNumber(sortedTraders.length)}
            </span>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  {renderSortHeader("Trader", "trader")}
                  {renderSortHeader("X Account", "xUsername")}
                  {renderSortHeader("Best Rank", "bestRank")}
                  {renderSortHeader("Change", "rankChange")}
                  {renderSortHeader("Seen", "daysSeen")}
                  {renderSortHeader("Top 10", "top10Count")}
                  <th>Source</th>
                  <th>Tags</th>
                </tr>
              </thead>
              <tbody>
                {visibleTraders.map((trader) => {
                  const sources = sourceLabels(trader);
                  return (
                    <tr 
                      key={trader.wallet} 
                      onClick={() => setSelectedTrader(trader)}
                      className="trader-row"
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <div className="identity">
                          {trader.profileImage ? (
                            <img src={trader.profileImage} alt="" loading="lazy" />
                          ) : (
                            <div className="avatar">{(trader.userName ?? "?").slice(0, 1).toUpperCase()}</div>
                          )}
                          <div>
                            <strong>{highlightText(trader.userName ?? trader.profileName ?? "Unnamed", query)}</strong>
                            <span className="wallet-addr">{shortWallet(trader.wallet)}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        {trader.xUsername ? (
                          <span 
                            className="xLink" 
                            onClick={(e) => {
                              // Prevent row click from opening details drawer
                              e.stopPropagation();
                              window.open(`https://x.com/${trader.xUsername}`, "_blank", "noreferrer");
                            }}
                          >
                            <span className="xMark" aria-hidden="true">X</span>
                            @{highlightText(trader.xUsername, query)}
                          </span>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td>
                        <div className="rank-value">
                          #{trader.bestRankAllTime ?? "-"}
                        </div>
                      </td>
                      <td>{rankDelta(trader.rankChange)}</td>
                      <td>
                        <span className="days-seen-value">{trader.daysSeen}d</span>
                      </td>
                      <td>{formatNumber(trader.top10Count)}</td>
                      <td>
                        <div className="sources" title={sources.join("\n")}>
                          {sources.slice(0, 2).map((item) => (
                            <span key={item}>{item}</span>
                          ))}
                          {sources.length > 2 ? <em className="source-more">+{sources.length - 2}</em> : null}
                        </div>
                      </td>
                      <td>
                        <div className="tags">
                          {trader.tags.slice(0, 3).map((item) => (
                            <span 
                              key={item} 
                              className={`tag-pill-sm ${tag === item ? "active" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleTagClick(item);
                              }}
                            >
                              {highlightText(item, query)}
                            </span>
                          ))}
                          {trader.tags.length > 3 ? <span className="tag-more">+{trader.tags.length - 3}</span> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <nav className="pagination" aria-label="X-linked wallet pages">
            <p aria-live="polite">
              Showing {formatNumber(traderDisplayStart)}-{formatNumber(traderPageEnd)} of {formatNumber(sortedTraders.length)}
            </p>
            <div className="paginationControls">
              <button 
                type="button" 
                onClick={() => setTraderPage((page) => Math.max(1, page - 1))} 
                disabled={traderPage === 1}
              >
                <ChevronLeft size={16} aria-hidden="true" />
                Previous
              </button>
              <span className="page-indicator">
                Page {formatNumber(traderPage)} / {formatNumber(traderPageCount)}
              </span>
              <button 
                type="button" 
                onClick={() => setTraderPage((page) => Math.min(traderPageCount, page + 1))} 
                disabled={traderPage === traderPageCount}
              >
                Next
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </nav>
        </div>

        {/* Right Panel: Latest leaderboard */}
        <div className="panel">
          <div className="panelHeader">
            <div>
              <h2>Latest leaderboard</h2>
              <p>{selectedLeaderboard?.snapshotDate ?? "No snapshot"} snapshot</p>
            </div>
          </div>
          <div className="leaderboardPicker">
            <label htmlFor="leaderboard-select">Leaderboard slice</label>
            <select id="leaderboard-select" className="fullSelect" value={selectedLeaderboard?.key ?? ""} onChange={(event) => setLeaderboardKey(event.target.value)}>
              {latestLeaderboards.map((leaderboard) => (
                <option key={leaderboard.key} value={leaderboard.key}>
                  {leaderboard.query.category} / {leaderboard.query.timePeriod} / {leaderboard.query.orderBy}
                </option>
              ))}
            </select>
            <p className="selected-slice-desc">{selectedLabel}</p>
          </div>
          <div className="leaderRows">
            {(selectedLeaderboard?.rows ?? []).slice(0, 25).map((row) => {
              // Find if this leaderboard trader exists in our X-linked list
              const matchingTrader = traders.find(t => t.wallet.toLowerCase() === row.proxyWallet.toLowerCase());

              return (
                <div 
                  className={`leaderRow ${matchingTrader ? "linked-leader" : ""}`} 
                  key={`${row.proxyWallet}-${row.rank}`}
                  onClick={() => {
                    if (matchingTrader) {
                      setSelectedTrader(matchingTrader);
                    } else {
                      window.open(`https://polymarket.com/profile/${row.proxyWallet}`, "_blank", "noreferrer");
                    }
                  }}
                  title={matchingTrader ? "Click to view detailed profile" : "Click to view Polymarket profile"}
                  style={{ cursor: "pointer" }}
                >
                  <span className="leader-rank">#{row.rank ?? "-"}</span>
                  <strong className="leader-name">{row.userName ?? shortWallet(row.proxyWallet)}</strong>
                  
                  {matchingTrader ? (
                    <span className="leader-badge-linked" title="Verified X Account Linked">
                      X Link
                    </span>
                  ) : (
                    <em className="leader-wallet-sub">{row.xUsername ? `@${row.xUsername}` : shortWallet(row.proxyWallet)}</em>
                  )}
                  
                  {matchingTrader ? (
                    <span className="arrow-indicator"><Info size={14} /></span>
                  ) : (
                    <span className="arrow-indicator"><ExternalLink size={14} /></span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Trader Profile Side Drawer */}
      {selectedTrader && (
        <div className="drawer-overlay" onClick={() => setSelectedTrader(null)}>
          <div className="drawer-container" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="drawer-title-area">
                <h2>Trader Profile</h2>
                <div className="drawer-wallet-container">
                  <code>{selectedTrader.wallet}</code>
                  <button 
                    type="button" 
                    className="copy-wallet-btn" 
                    onClick={() => handleCopyWallet(selectedTrader.wallet)}
                    title="Copy wallet address"
                  >
                    {copiedWallet ? <Check size={14} className="success-color" /> : <Copy size={14} />}
                    <span>{copiedWallet ? "Copied!" : "Copy"}</span>
                  </button>
                </div>
              </div>
              <button 
                type="button" 
                className="drawer-close-btn" 
                onClick={() => setSelectedTrader(null)}
                aria-label="Close profile drawer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="drawer-body">
              <div className="drawer-profile-hero">
                <div className="drawer-avatar-glow">
                  {selectedTrader.profileImage ? (
                    <img src={selectedTrader.profileImage} alt="" className="drawer-avatar" />
                  ) : (
                    <div className="drawer-avatar-placeholder">
                      {(selectedTrader.userName ?? "?").slice(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="drawer-profile-meta">
                  <h3>{selectedTrader.userName ?? selectedTrader.profileName ?? "Unnamed Trader"}</h3>
                  {selectedTrader.xUsername ? (
                    <a 
                      href={`https://x.com/${selectedTrader.xUsername}`} 
                      target="_blank" 
                      rel="noreferrer" 
                      className="drawer-x-badge"
                    >
                      <span className="x-letter">X</span>
                      <span>@{selectedTrader.xUsername}</span>
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <span className="drawer-no-x">No X Account linked</span>
                  )}
                  {selectedTrader.profileBio && (
                    <p className="drawer-bio">"{selectedTrader.profileBio}"</p>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="drawer-actions">
                <a 
                  href={`https://polymarket.com/profile/${selectedTrader.wallet}`} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="btn btn-primary full-width-btn"
                >
                  <span>View Polymarket Profile</span>
                  <ExternalLink size={16} />
                </a>
              </div>

              {/* Stats Section */}
              <div className="drawer-section">
                <h4>Rankings & Performance</h4>
                <div className="drawer-stats-grid">
                  <div className="drawer-stat-item">
                    <span className="stat-label">Best Rank All-Time</span>
                    <strong className="stat-val highlight-blue">#{selectedTrader.bestRankAllTime ?? "-"}</strong>
                  </div>
                  <div className="drawer-stat-item">
                    <span className="stat-label">Current Best Rank</span>
                    <strong className="stat-val">#{selectedTrader.currentBestRank ?? "-"}</strong>
                  </div>
                  <div className="drawer-stat-item">
                    <span className="stat-label">Previous Best Rank</span>
                    <strong className="stat-val">#{selectedTrader.previousBestRank ?? "-"}</strong>
                  </div>
                  <div className="drawer-stat-item">
                    <span className="stat-label">Rank Change</span>
                    <strong className={`stat-val ${selectedTrader.rankChange !== null && selectedTrader.rankChange < 0 ? "text-green" : "text-red"}`}>
                      {rankDelta(selectedTrader.rankChange)}
                    </strong>
                  </div>
                  <div className="drawer-stat-item">
                    <span className="stat-label">Days Seen</span>
                    <strong className="stat-val">{selectedTrader.daysSeen} days</strong>
                  </div>
                  <div className="drawer-stat-item">
                    <span className="stat-label">Appearances</span>
                    <strong className="stat-val">{selectedTrader.appearances} boards</strong>
                  </div>
                </div>
              </div>

              {/* Top Rankings Counts */}
              <div className="drawer-section">
                <h4>Milestones & Trophies</h4>
                <div className="drawer-milestone-badges">
                  <div className="milestone-card gold">
                    <span className="label">Top 10 Rows</span>
                    <span className="count">{selectedTrader.top10Count}</span>
                  </div>
                  <div className="milestone-card silver">
                    <span className="label">Top 50 Rows</span>
                    <span className="count">{selectedTrader.top50Count}</span>
                  </div>
                  <div className="milestone-card bronze">
                    <span className="label">Top 100 Rows</span>
                    <span className="count">{selectedTrader.top100Count}</span>
                  </div>
                </div>
              </div>

              {/* Tags */}
              <div className="drawer-section">
                <h4>Behavioral Tags</h4>
                <div className="drawer-tags-list">
                  {selectedTrader.tags.length > 0 ? (
                    selectedTrader.tags.map((item) => (
                      <button 
                        key={item} 
                        type="button"
                        className={`drawer-tag-chip ${tag === item ? "active" : ""}`}
                        onClick={() => {
                          setTag(item);
                          setSelectedTrader(null);
                        }}
                        title={`Filter by tag #${item}`}
                      >
                        #{item}
                      </button>
                    ))
                  ) : (
                    <span className="muted">No tags indexed</span>
                  )}
                </div>
              </div>

              {/* Observed Boards */}
              <div className="drawer-section">
                <h4>Observed Leaderboard Slices</h4>
                <div className="drawer-sources-list">
                  {sourceLabels(selectedTrader).map((item) => (
                    <span key={item} className="drawer-source-pill">
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              {/* Dates */}
              <div className="drawer-section drawer-timeline">
                <div className="timeline-date-item">
                  <span className="timeline-lbl">First Spotted</span>
                  <strong className="timeline-val">{formatDateTime(selectedTrader.firstSeen)}</strong>
                </div>
                <div className="timeline-date-item">
                  <span className="timeline-lbl">Last Active</span>
                  <strong className="timeline-val">{formatDateTime(selectedTrader.lastSeen)}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
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
