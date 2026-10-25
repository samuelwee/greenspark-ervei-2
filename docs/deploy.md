# Deploying the demo (Render)

The API can also serve the built web app, so the whole demo runs as **one Node web service**.

| Setting | Value |
| --- | --- |
| Runtime | Node (22 or newer; set `NODE_VERSION=22.22.0`) |
| Build command | `npm install && npm run build -w web` (the repo's `.npmrc` makes `npm install` include build tools even when `NODE_ENV=production`) |
| Start command | `npm run start -w api` |
| Health check path | `/api/health` |
| `GREENSPARK_BASIC_AUTH` | `user:password`. Optional but recommended: the demo has no real sign-in, so without it anyone with the link can act as the manager. Health checks are exempt. Remove the variable to open the site up. |
| `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` | Optional. Turns on the AI summaries on each case. With an Anthropic key the app uses Claude (Haiku 5.5, paid per use); otherwise Gemini (Flash-Lite, free tier). Set `AI_PROVIDER=claude` or `gemini` to choose when both keys are set. `CLAUDE_MODEL` / `GEMINI_MODEL` change the model. |

Render supplies `PORT`; the server listens on it.

## Things to know

- **Data is temporary on the free plan.** The SQLite file lives on the service's disk, which is wiped on every deploy and restart (free services also sleep after about 15 minutes idle). Each wake-up starts from the original 200 cases. For data that survives, attach a paid persistent disk and set `GREENSPARK_DB` to a path on it.
- **Flowchart edits are temporary too.** The hardship-flow JSON (`data/admin/utility_hardship_mapping.json`) is part of the repository, so edits made on the live site reset on every deploy and restart. To keep them, put the file on a persistent disk and set `GREENSPARK_FLOW_FILE` to it (copy the repo's file there first).
- **Single instance only.** SQLite is a local file, so do not scale to more than one instance.
- **Auto-deploy** follows the branch you connect. Merge the pull request and switch the service to `main` when ready.
- Everything is fictional demo data. Do not load real customer data here.

## Coolify (or any Docker host) with a persistent disk

The repo's `Dockerfile` builds one container. In Coolify: **New resource → Public/Private Repository**, build pack **Dockerfile**, port **3001**. Then under **Persistent Storage** add a volume with destination path `/data`. That one volume holds both the case database (`/data/greenspark.sqlite`) and the flowchart JSON (`/data/utility_hardship_mapping.json`, copied from the repo on first start only). Set `GREENSPARK_BASIC_AUTH` (`user:password`) if the site is public. Keep to one instance. To reset the flowchart JSON to the repo's version, delete that file in the volume and redeploy.

## Fly.io (live at https://ervei.fly.dev, app `ervei`)

`fly.toml` deploys the same `Dockerfile` as one machine (shared-cpu-1x, 512 MB, with 256 MB swap) in US East (`iad`) with a 1 GB volume, `greenspark_data`, mounted at `/data`. As on Coolify, the case database and flowchart JSON live there and survive deploys and restarts. Every push to `main` on GitHub (samuelwee/greenspark-ervei-2) deploys automatically: `.github/workflows/fly-deploy.yml` runs `flyctl deploy --remote-only` with the repository secret `FLY_API_TOKEN` (a deploy token from `fly tokens create deploy -a ervei`). The full dataset is committed compressed (`accounts.all.jsonl.gz`, `case-queue.all.json.gz`) and unpacked by the build. To deploy by hand from a local checkout instead, run `fly deploy --remote-only --dns-checks=false`. The DNS check at the end queries 8.8.8.8, which some networks block; it then waits a full minute before giving up, after the app is already live. The `Dockerfile` installs packages and copies the data in their own layers, so a code-only change reuses both and builds in seconds. Keep it to one machine and one volume (SQLite). The machine suspends when idle and resumes on the next request. The case database is `/data/cases.sqlite` (`GREENSPARK_DB` in `fly.toml`): it was copied from the earlier app, `greenspark-ervei`, on 25 Oct 2026. No `GREENSPARK_BASIC_AUTH` is set, so the site is open. Add one with `fly secrets set GREENSPARK_BASIC_AUTH=user:password`. To use Claude for the AI summaries, run `fly secrets set ANTHROPIC_API_KEY=...`; with both keys set, Claude is used unless `AI_PROVIDER=gemini` is set.
