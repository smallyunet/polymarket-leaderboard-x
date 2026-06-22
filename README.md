# Polymarket Leaderboard X Tracker

Tracks Polymarket leaderboard wallets that expose X usernames across every documented leaderboard parameter combination.

## What It Collects

The collector enumerates the full documented leaderboard matrix:

- `category`: `OVERALL`, `POLITICS`, `SPORTS`, `ESPORTS`, `CRYPTO`, `CULTURE`, `MENTIONS`, `WEATHER`, `ECONOMICS`, `TECH`, `FINANCE`
- `timePeriod`: `DAY`, `WEEK`, `MONTH`, `ALL`
- `orderBy`: `PNL`, `VOL`
- pagination: `limit=50`, `offset=0..1000`

That is up to `11 * 4 * 2 * 21 = 1848` leaderboard page requests per snapshot day.

The app then derives:

- latest leaderboard views
- X-linked trader index
- wallet-level historical ranking stats
- automatic tags such as `x-linked`, `verified`, `rising-fast`, `consistent`, `multi-category`, `sports-heavy`, `high-volume`, and `high-pnl`

## Local Development

```bash
npm install
npm run collect
npm run build:data
npm run dev
```

For a smaller test collection:

```bash
PM_CATEGORIES=OVERALL PM_TIME_PERIODS=DAY PM_ORDER_BY=PNL PM_MAX_OFFSET=0 npm run collect
npm run build:data
```

Profile enrichment defaults to `PM_PROFILE_MODE=x-only`, which refreshes the public profile endpoint only for wallets whose leaderboard rows already expose an X username. Set `PM_PROFILE_MODE=new-or-stale` if you want to query public profiles for every newly observed or stale wallet.

## GitHub Pages Deployment

This repository includes `.github/workflows/collect-and-deploy.yml`.

1. Push the repository to GitHub.
2. In the repo settings, enable Pages with GitHub Actions as the source.
3. The workflow runs daily and can also be started manually from the Actions tab.

The workflow:

1. installs dependencies
2. collects the latest leaderboard snapshots
3. rebuilds derived JSON data
4. commits changed `data/` and `public/data/`
5. builds the static app
6. deploys `dist/` to GitHub Pages

## Data Layout

```text
data/
  snapshots/YYYY-MM-DD/*.json
  cache/profiles.json
public/
  data/derived/*.json
```

Raw snapshots are intentionally kept separate from derived app data so historical metrics can be recomputed when the tag logic changes.
