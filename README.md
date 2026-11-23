# Seat picker / Studio +91

A shared classroom icebreaker with 20 two-person benches, 40 selectable spots, cats, pencil mountains, backbench doodles, and simulated famous visitors.

## Visual style and supplied artwork

- The `studio +91` badge is preserved from the supplied logo image; the adjacent wordmark reads `seat picker.`.
- The supplied green chalkboard artwork is used intact in the 3D room, preserving its embedded chalk lettering and illustrations. The welcome banner is removed. Chalk drawings elsewhere are cropped from the supplied transparent illustration sheet.
- Notebook panels use the blank paper texture from the supplied notebook reference, blue rules, pink margins, taped corners, and distinct sketch-pen SVG doodles. No person's name or photograph from that reference is included in the web assets.
- Patrick Hand is locally served and used throughout non-chalkboard text, including controls and dialogs.
- Dynamic chalkboard text prefers the exact `Chalk board` or `Chalkboard` face if it is installed on the viewer's device. A licensed webfont file has not been provided, so the existing locally served Schoolbell face is an explicit fallback for those labels. The supplied board's lettering is already embedded in its artwork and is not replaced by the fallback.
- The fourth referenced image has not been provided as an accessible attachment. The currently implemented notebook treatment follows the third supplied reference.

Reference attachments remain unchanged; derived web assets are in `public/branding` and `public/visuals`.

## How it works

- One classroom, always open. Share the site link; there are no room codes.
- Visitors pick a desk and a nickname. The counter, heatmap and results update for everyone within a few seconds.
- Eleven famous "visitors" (Sunny Deol, Gabbar, Piku and friends) wander the room and try desks for fun. They run in each browser and are never saved or counted.
- Hidden host tools: the faint "···" at the bottom right erases every seat. It needs the `ADMIN_RESET_KEY` passcode.

## Run locally

```bash
npm install
npm run dev     # http://localhost:5173, seats kept in memory
```

Optional: put `ADMIN_RESET_KEY=some-local-passcode` in `.env.local` to try the host tools.

## Validate

Run `npm test` for TypeScript checking and the focused single-room tests, then `npm run build` for a production build. Local tests exercise memory storage and mocked Upstash REST responses, not an actual hosted database.

The supplied implementation guide is saved in [docs/single-room-guide.md](docs/single-room-guide.md). The implementation additionally rejects corrupt storage responses instead of silently dropping seats, logs invalid browser storage, requires a reset passcode of at least 12 characters, and explicitly redraws visitor cats in the idle 3D scene. Atomic Redis Lua operations enforce the 400-vote limit under simultaneous submissions and keep seat snapshots and resets consistent across function instances.

## Deploy on Vercel

1. In the Vercel project, open Storage and add **Upstash for Redis** (Free). Connect it to Development, Preview and Production.
2. Settings → Environment Variables → add `ADMIN_RESET_KEY` (12+ characters) for Production and Preview.
3. Push to GitHub. Check that `/api/health` returns `"ok": true` and `"storage": "upstash"`.

Preview and Production keep separate seats. Use the "···" host tools to erase seats before an event.

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Storage status |
| `/api/room` | GET | The classroom (cached about 2 s at the edge) |
| `/api/vote` | POST `{ token, name, seat }` | Save or move your seat |
| `/api/reset` | POST `{ key }` | Erase all seats (host passcode) |
