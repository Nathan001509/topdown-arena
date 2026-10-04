# Topdown Arena

A browser based 1v1 / 2v2 arena shooter. The Node server owns movement, shots, collisions, health, respawns and scoring. The browser sends only keyboard, aim and fire input.

## Run locally

1. Install Node.js 18 or newer.
2. In this folder run `npm install`.
3. Run `npm start` (or `node server.js`).
4. Open [http://localhost:3000](http://localhost:3000) in two or more browser tabs. Select a mode and join. Use the displayed room code or **Copy invite** to bring friends into the same room.

The server listens on `PORT` when provided by a host, otherwise port 3000. On an HTTPS page the client automatically connects over `wss://`; locally it uses `ws://`.

## Deploy free on Render

Render supports WebSockets on web services and provides HTTPS/TLS for its public service URL. Its free web services can spin down after 15 minutes without inbound traffic, so the first visit after idle may take about a minute to wake up. See [Render Web Services](https://render.com/docs/web-services), [WebSockets](https://render.com/docs/websocket), and [Free instances](https://render.com/docs/free).

1. Put this `topdown-arena` folder in a GitHub repository and push it to GitHub. If this folder is inside a larger repository, keep its relative path for the next step.
2. In Render, choose **New → Web Service**, connect GitHub, and select the repository.
3. Set **Root Directory** to `outputs/topdown-arena` if you kept this folder in the supplied project layout. Leave it blank if the repository itself contains `package.json` at its root.
4. Choose **Node** as the runtime, **Free** as the instance type, `npm install` as the build command, and `npm start` as the start command.
5. Click **Create Web Service** and wait for the deploy to finish. Render assigns an `https://…onrender.com` URL; open that link and share a room invite with friends. The page selects `wss://` automatically.

No extra WebSocket URL, port, or certificate setting is needed: the server binds to `0.0.0.0` and Render supplies `PORT` and TLS termination. Anyone joining from the same public link can choose a mode and use an empty room code for quick match, or enter a code to join that room.

## Controls and rules

- **WASD** (or arrow keys) to move, mouse to aim, hold left click to fire.
- On phones, use the left stick to move and drag the right stick to aim and fire. Turn the phone sideways for a larger arena view.
- 100 HP, 25 damage per hit, 250 ms firing cooldown, 2 second respawn.
- Teammates cannot damage one another. The first team to 10 kills wins; the next round starts after four seconds.

## Good next additions

Client side prediction and server reconciliation would make movement feel more immediate on higher latency connections. Interpolating received snapshots would smooth remote players. Sound effects, more weapons, map selection, and a persistent party/invite flow would expand the game.
