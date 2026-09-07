# Lumen Together relay

A tiny WebSocket relay for Lumen watch parties. **You usually do not need this.**

Lumen can host a room itself — Watch together → *Start a room* — and that is the
right answer whenever the host can be reached directly: same house, a forwarded
port, or a mesh VPN like Tailscale or ZeroTier.

Run this standalone relay when nobody's home connection can accept an inbound
connection. It sits on a machine both watchers can reach and passes messages
between them. It never sees a single frame of video: watchers keep their own
copies of the file and the relay only carries timestamps, votes, and who is in
the room.

## Running it

```bash
npm install && npm start
```

Listens on `PORT` (default `7345`). Then in Lumen, on every watcher's machine:
Watch together → Join → enter `your-relay-host:7345` and the room code.

Room codes are created on demand: the first person to use a code makes that room,
and it disappears when the last person leaves.

## Behind a reverse proxy

WebSocket upgrades must be forwarded. For nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:7345;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    # Sync accuracy depends on messages not being buffered.
    proxy_buffering off;
}
```

With TLS in front, watchers enter `wss://your-host` instead of a bare address.

## A note on latency

The relay's clock is the reference every watcher steers against, and each one
measures its offset from it continuously. Absolute distance to the relay costs
almost nothing — it is cancelled out by the offset estimate. What does hurt is
*asymmetric* or wildly variable latency, so prefer a host with a stable
connection over one that is merely close.
