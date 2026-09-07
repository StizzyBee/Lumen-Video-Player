# Lumen Together relay

A tiny WebSocket relay for Lumen watch parties and call-style player invitations.

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
npm install
npm run relay
```

Listens on `PORT` (default `7345`). Then in Lumen, on every watcher's machine:
Watch together → Join → enter `your-relay-host:7345` and the room code.

Room codes are created on demand: the first person to use a code makes that room,
and it disappears when the last person leaves.

## Player invitations

The same relay also acts as Lumen's invitation directory. Enter its address in
**Settings → Watch together → Invitation relay** on both PCs. Each Lumen
installation then remains reachable by its Lumen ID while the app is open.

Invitations are online-only and expire after 60 seconds. The relay stores no
accounts, contacts, chat history, or offline messages. It only forwards the
short-lived room address and the recipient's Accept/Decline response.

The relay assigns `LMN-1`, `LMN-2`, and so on in first-seen order and keeps the
mapping in `data/invite-registry.json`. Set `LUMEN_INVITE_REGISTRY` to use a
different file. A number is global only when every public Lumen installation
uses the same authoritative relay.

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
