# Seat picker / Studio +91

A shared classroom icebreaker with 20 two-person benches, 40 selectable spots, cats, pencil mountains, backbench doodles, and live cursors.

## Visual style and supplied artwork

- The `studio +91` badge is preserved from the supplied logo image; the adjacent wordmark reads `seat picker.`.
- The supplied green chalkboard artwork is used intact in the welcome area and the 3D room, preserving its embedded chalk lettering and illustrations. Chalk drawings elsewhere are cropped from the supplied transparent illustration sheet.
- Notebook panels use the blank paper texture from the supplied notebook reference, blue rules, pink margins, taped corners, and distinct sketch-pen SVG doodles. No person's name or photograph from that reference is included in the web assets.
- Patrick Hand is locally served and used throughout non-chalkboard text, including controls and dialogs.
- Dynamic chalkboard text prefers the exact `Chalk board` or `Chalkboard` face if it is installed on the viewer's device. A licensed webfont file has not been provided, so the existing locally served Schoolbell face is an explicit fallback for those labels. The supplied board's lettering is already embedded in its artwork and is not replaced by the fallback.
- The fourth referenced image has not been provided as an accessible attachment. The currently implemented notebook treatment follows the third supplied reference.

Reference attachments remain unchanged; derived web assets are in `public/branding` and `public/visuals`. Gameplay, room IDs, cats, pencil counts, and live cursors are unaffected by the style change.

## Deploy without Redis: one Node service

Redis is **not required** for a single-server deployment. The same Node process serves the website, stores votes in a local JSON file, and broadcasts live cursors. Cats, shared seats, pencil piles, and charts are unchanged. No separate database needs to be provisioned.

### Redis-free build and start

```powershell
npm ci --include=dev
npm run build
npm run start:standalone
```

`start:standalone` explicitly uses local files and ignores `REDIS_URL`, even if it was left in the hosting environment. The Redis implementation is not imported or connected in this mode. The npm Redis library can remain in the package for the optional Vercel deployment; it is not a paid service.

### One-service hosting on Render

1. Put this updated project's contents in your GitHub repository.
2. In Render, select **New > Blueprint** and connect the repository. The included `render.yaml` creates **one free Node web service**, not a Redis service or database.
3. Review the configuration before approving. The build is `npm ci --include=dev && npm run build`; the start command is `npm run start:standalone`; health checking uses `/api/health`. Node 24 is selected by the project's `engines` and `.nvmrc`.
4. Deploy, open the generated HTTPS link, create a classroom, and share that room's invite link. All participants use the same website and server.

**Free is for demos, not guaranteed meeting hosting.** Render states that free services sleep after 15 minutes without inbound traffic, may take about a minute to wake up, can restart at any time, and have an ephemeral filesystem. Room votes are lost when the service sleeps, restarts, or redeploys. Free services cannot attach persistent disks. Do not rely on this tier for guaranteed 200-person uptime or retained results.

For persistent rooms, choose a paid single web service and attach a persistent disk at `/opt/render/project/src/data`. Keep `DATA_FILE` unset so the default `data/rooms.json` is stored there, or set it to a file under your chosen disk mount. Only one service instance may access the file. Keep autoscaling disabled, preserve disk backups, and validate the deployed service before the event. This pays for the web server/disk, **not a separate Redis integration**. No paid service is provisioned by this source package.

If you create a Render Web Service manually instead of a Blueprint, enter the same build/start commands. Do not select **Static Site**: static hosting cannot provide rooms and cursors. Other hosts supporting one long-running Node 24 process, HTTPS, streaming HTTP responses, and a writable disk can use the same Redis-free mode.

Official limits: [Render free services](https://render.com/docs/free) and [persistent disks](https://render.com/docs/disks).

### Existing rooms and limits

Existing cloud Redis rooms are not automatically copied into the file store. A new host starts with new rooms unless the operator deliberately migrates an approved data file. Local meeting data is never included in the ZIP.

The single-server design has passed local tests with 200 clients choosing the same desk. Its actual host/network capacity must still be tested. Without shared storage it cannot run as multiple replicas or as independent serverless functions.

## Optional Vercel deployment: shared Redis required

The website and all API routes deploy together. Redis is connected once from the same Vercel dashboard; you do not deploy a separate backend website.

Vercel's serverless API still requires shared storage. The Redis-free start command is **not** a workaround for Vercel Functions: requests may reach different instances and local files do not provide durable shared state. Keep this optional configuration if you want Vercel later, or use the one-service instructions above to avoid the integration entirely.

1. **Use this updated source.** Extract the project ZIP and put its contents in your GitHub repository, or push this working tree after reviewing it. The ZIP has `package.json` and `vercel.json` at its root. A previously uploaded GitHub revision will not acquire these changes automatically.
2. In Vercel, select **Add New > Project** and import that repository. Select the repository root, not `src` or `dist`.
3. Use **Node.js 24.x** and **Vite**. The included `vercel.json` sets installation to `npm ci --include=dev`, build to `npm run build`, and output to `dist`. Keep Fluid Compute enabled. The API function is included automatically; do not enter `npm start` as a Vercel build command.
4. Open **Storage > Marketplace Database Providers > Redis** and create a **Redis Cloud** database. This integration provides the standard Redis TCP/TLS API, including pub/sub and Lua scripts. A REST-only database URL is not compatible with this implementation.
5. **Connect Project**, select this app and the appropriate environments, and confirm the integration supplied a server-side **`REDIS_URL`**. Do not prefix it with `VITE_`, paste it into source, or put it in the ZIP. Keep the database near the function region.
6. **Redeploy** after connecting storage. The UI can deploy before Redis is connected, but the API deliberately returns a clear `503` setup error rather than saving rooms to temporary function disk.
7. Open `https://YOUR-APP.vercel.app/api/health`; it must return `{"ok":true}`. Then open the website, create a classroom, and share its invite link. If Deployment Protection requires sign-in, ensure all attendees have the intended access before the meeting.

**Choose a suitable plan before the event.** The app is designed for 200 people, but a free database's connection, throughput, memory, or durability limits may not suffice. Redis Cloud states that persistence is enabled on paid plans; configure the retention/durability you need. Each warm API instance uses two Redis connections (commands and subscriptions), not one per participant. Check provider and Vercel usage/billing, use a no-eviction policy for saved room data, and verify limits on the deployed environment. No paid resources are created by this source package.

Official references: [Vercel storage integrations](https://vercel.com/docs/marketplace-storage), [Redis Cloud integration](https://redis.io/docs/latest/operate/rc/cloud-integrations/vercel/), and [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration).

### What makes the cloud deployment work

- Atomic Redis scripts create rooms and update votes without losing simultaneous selections or double-counting a browser profile. Multiple people may choose the same seat.
- Room snapshots and cursor changes cross API instances through Redis pub/sub. Private voting tokens and cursor session secrets are never included in public snapshots.
- The existing server-sent events (SSE) protocol is retained rather than requiring beta WebSockets. The Vercel handler stays active for the stream's lifetime; streams rotate after roughly 230-245 seconds, below the configured 300-second function limit. Reconnects obtain new credentials and reload saved state.
- Cursor updates are throttled, coalesced into 100 ms batches, and bounded for slow clients. Sessions use renewable leases, so disconnected or terminated workers do not hold capacity forever. Full periodic snapshots repair missed transient messages.
- Preview and production default to different Redis namespaces. `REDIS_PREFIX` can choose an explicit 1-80 character namespace using letters, digits, underscores, or hyphens. Give independently tested preview branches their own database or prefix. Never point a disposable preview at production's prefix.
- Vercel serves built assets from its CDN; the API cannot serve local project files. All browser calls use same-origin `/api` routes, so there is no separate API domain or CORS setup.

Vercel has not been deployed or load-tested merely by building this ZIP. Complete the hosted checks below before relying on it for a meeting.

## Run locally

Requires Node.js 24 LTS and npm.

```powershell
npm ci --include=dev
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to the server on port 3001.

For a local production preview:

```powershell
npm run build
npm start
```

Open http://localhost:3001. `PORT` overrides the port. Without `REDIS_URL`, local development retains the original JSON persistence at `data/rooms.json`; `DATA_FILE` can override it. This file is private, ignored by Git, and is never packaged.

To exercise cloud behavior locally, set `REDIS_URL` and a separate `REDIS_PREFIX` in your process before `npm start`. The local server then uses the same Redis room and event implementations as Vercel. Node environment variables are not automatically loaded from `.env.example`; it only documents their names. On Vercel they are supplied by the integration.

The build precompresses static assets for a standalone Node server; Vercel's CDN handles its own compression. The app shell does not wait for the lazy 3D engine. The seat map works without WebGL.

## Play

1. Open a classroom and share its link or six-character room code.
2. Guests choose one side of a bench and enter a first name or nickname.
3. Cats mark chosen spots; your cat is golden. Each vote adds one oversized pencil to the shared desk's mound. Moving seats moves your contribution instead of duplicating it.
4. Live named cursors show classmates exploring. Cursors in 3D and map views are only displayed to viewers of the matching view.
5. Reveal the seating story: front rows 1-2, middle row 3, and back rows 4-5. Download aggregate results as CSV.

All five rows have equal walking gaps, with aisles between the four bench desks in each row. Seat IDs A1-E8 are unchanged. More than two people may vote for the same bench: this is a seating-habits survey, not a capacity reservation system.

## Validate

```powershell
npm test
npm run build
```

Tests cover 40 seat identities, equal aisle gaps, 200-pencil placement, vote updates, JSON persistence and rollback, private token handling, SSE delivery, input validation, compression, platform-parsed request bodies, API-only routing, and missing Vercel storage.

For tests against an isolated real Redis server:

```powershell
$env:TEST_REDIS_URL = 'redis://127.0.0.1:16379'
npm run test:redis
```

These tests open 200 SSE clients across two independent server instances, concurrently select one desk, repeatedly send 4,000 cursor updates through the other instance, move a vote, create a fresh database connection, disconnect a cursor, and reconnect on another instance after a short simulated function rotation. They also verify preview isolation and a shared rate limit. Tests delete only keys in their randomly generated `test-*` namespaces. Never run load tests against an unapproved shared/production database.

### Before the 200-person meeting

- Verify two different devices see the same room and each other's cursors.
- Confirm saved results survive a redeployment and the database plan's persistence is enabled.
- Keep clients connected past five minutes to verify automatic reconnection.
- Run a sustained 200-participant movement test against the actual deployment and review function, database, network, and billing limits. Local multi-instance tests are not a hosted capacity guarantee.
- Verify attendees' network policies and any Vercel access protection permit the site.

## Existing rooms and privacy

Existing local JSON rooms are not automatically uploaded to Redis. They remain untouched on your computer. New cloud rooms are separate; use their new invite links. Deployments using the same production database and namespace retain cloud rooms across app redeployments.

Anyone with a room link can see names, seat choices, and cursor positions. Use nicknames and keep invite links within your group. One vote is retained per browser profile, not verified per person. Clearing local storage or using another browser permits another vote.

Room votes remain until the operator deletes their database namespace; there is no automatic expiration or room-deletion interface. Cursor sessions are short-lived but temporarily stored in Redis for cross-instance routing; public snapshots never include session secrets. Agree on a retention policy before using real participant data.

The deployment allows at most 250 simultaneous live tabs per room, 1,000 votes per room, 500 stored rooms per namespace, and 20 new rooms per IP per hour. This app is intended for trusted meeting groups, not anonymous public events. It has no production SLA or independently verified 200-user hosting guarantee.

## VibeHub packages are different

The earlier source ZIP is not a VibeHub published website bundle. VibeHub distinguishes source attachments from built website uploads and serves published apps beneath `/app/<project-id>/`. This Vercel package should be imported into Vercel, not uploaded unchanged as a VibeHub website. The documented VibeHub shared-storage and proxy limits do not provide this app's realtime backend.
