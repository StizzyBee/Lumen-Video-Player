# Together — synchronized watch parties

Watch a film with someone on the other side of the world and have it feel like
you are on the same sofa: the same frame on both screens, the audio landing on
the same beat, and anyone able to hit pause when they need to.

Everyone keeps their own copy of the file. Nothing is uploaded, nothing is
streamed between watchers — only timestamps, readiness, and votes.

## Why not just relay the events?

The obvious design — the one [Synclify](https://github.com/Synclify/Synclify)
uses, and the one most watch-party extensions use — is to broadcast the events:
"Ana pressed play at t=412.3". Receivers add the measured network latency and
seek there.

That is exactly right at the instant of the event, and slowly wrong forever
after. Two decoders never run at precisely the same speed: hardware differs,
dropped frames are never recovered, audio clocks tick at slightly different
rates. Nothing in an event-relay design measures the gap that opens up, so
nothing closes it. By the third act two watchers can be most of a second apart,
with no correction until somebody happens to press a button.

The second problem is what happens when you *do* notice. Writing
`video.currentTime` tears down and re-primes the audio device. You get a click,
a few dropped frames, and — because audio and video restart from marginally
different points — the "sound is slightly ahead of the picture" artefact that
makes shared viewing feel broken. Correcting a slow drift by seeking every
twenty seconds is worse than the drift.

## What Together does instead

**One authoritative timeline.** The relay publishes a media position pinned to
a server timestamp: `{ mediaTime, anchorTs, rate, paused }`. Any watcher can
compute where the room *should* be at any moment. Events become edits to that
timeline, and staying in sync becomes a control loop that never stops running.

**Continuous clock discipline.** Each client measures its offset from the
relay's clock with ping/pong exchanges, filtered the way NTP does it: keep the
*fastest* round trip in the window rather than averaging, because the quickest
exchange is the one least distorted by queueing in one direction. The offset is
slewed rather than stepped, so the sync target never jumps under the
controller's feet. Absolute distance to the relay costs nothing — it cancels
out. Only asymmetric or erratic latency hurts.

**Correction by rate, not by seeking.** Every 250ms each client compares itself
to the timeline and picks from a ladder:

| Gap | Action | Why |
| --- | --- | --- |
| ≤ 30 ms | nothing | Under one frame. As synchronized as the measurement can prove. |
| 30–600 ms | nudge the playback rate up to ±5% | Retires the gap over ~4s with the audio pipeline never interrupted. `preservesPitch` keeps voices unchanged, so it is inaudible. |
| > 600 ms, confirmed | seek | Only after three consecutive readings agree and a 3s cooldown, so one bad sample never causes a visible jump. |

Hysteresis keeps it from oscillating around the deadband edge. A proportional
controller leaves a small steady-state error against a persistently slow
decoder — about 16ms for a decoder running 0.4% slow, which is under half a
frame and deliberately left alone rather than chased.

**Everyone starts on the same frame.** Play is never applied on arrival, which
would start watchers staggered by their ping times. Instead the relay schedules
a start: *hold at position M, begin at server time T*, a shared absolute instant
roughly 900ms out. Every client seeks, waits, and releases together.

**The room waits for you.** Each client reports whether it could genuinely play
the next frame. If anyone stalls, the room pauses; when everyone is ready
again, it resumes itself from exactly where it stopped. Somebody joining
mid-film pauses the room until they have loaded. This is the part that makes it
feel like a sofa rather than two separate screens.

**Your own audio latency is yours.** Bluetooth headphones commonly add 150–300ms
of output delay. The room is in sync but *your* sound is late, and no amount of
room-level correction can see that — it is downstream of everything the app
measures. The panel has a personal audio-delay slider that shifts only your
timeline. Nudge it until dialogue lands with everyone else.

**Different rips still work.** Watchers are matched on normalized title plus
runtime within 5 seconds, so two different encodes of the same film pair up
while a different cut does not. A mismatch is flagged rather than blocked.

## Pause democracy

- **Anyone can pause, instantly, with no vote.** Getting up should not need a
  committee.
- **Getting going again can need one.** Anyone else may call a vote to resume.
  It passes on a strict majority of everyone *except* the person who paused —
  so they cannot veto the room, and a room of two is not held hostage.
- **Persistent disruption can be voted down.** A vote can take pause and seek
  away from one watcher for 5 minutes, 10 minutes, or 1 hour. The subject never
  votes on their own ballot.
- Seeking is revoked alongside pausing. A watcher who could still jump to a
  random scene would wreck a film just as thoroughly as one hammering pause.
- Abstaining counts against change: silence when the window closes means the
  ballot fails.
- The room will never leave *nobody* able to pause — the last unrestricted
  watcher cannot be revoked.
- Restrictions survive a reconnect, so pulling the cable is not an escape.

## Connecting

Syncing is the easy half. The hard half is NAT: two home connections cannot
dial each other, and "just forward a port on your router" is where most people
give up.

**Lumen hosts the room itself.** *Watch together → Start a room* runs the relay
inside Lumen and produces a single invite line — `100.101.102.103:7345#ABC234`
— carrying the address and the room code together, so there is no way to get
one right and the other wrong. Your friend pastes that one line and is in.

**Which address gets handed out matters.** Lumen classifies every local address
by how far it actually reaches and offers the best one, labelled honestly:

| Reach | Meaning |
| --- | --- |
| `mesh` | A mesh VPN address. Works anywhere, nothing to configure. |
| `public` | Directly routable, if the firewall allows it. |
| `lan` | Same network only. |

The panel says *"Reachable anywhere over ZeroTier"* or *"Works on your network
only"* rather than printing an IP and leaving you to guess — because handing a
friend on another continent a `192.168.x.x` address is a failure that looks
exactly like success until they try it.

**Mesh VPN, set up in-app.** When no mesh address exists, the panel offers a
one-click **ZeroTier** install via winget (the same pattern Lumen already uses
for mpv and yt-dlp — from the official source, user-initiated, with live
progress), then takes a network ID and joins it. Joining needs administrator
rights, so Windows shows a UAC prompt; the network ID is validated against a
strict 16-hex pattern before it goes anywhere near an elevated command.
Tailscale is detected and supported too — sign in on both machines and its
`100.64/10` address is picked up automatically.

Lumen does not bundle or redistribute a VPN. It installs one on request, from
the vendor, only if you ask.

**Or run a relay in the middle.** When neither home connection accepts inbound
connections and you would rather not run a VPN, `server/` holds a standalone
relay (`npm run relay`) for a small always-on box. It reuses the same room
logic, so the rules cannot diverge.

## The in-app guide

`TogetherGuide.tsx` is the user-facing explainer, mounted in two places from
one component: **Settings -> Watch together** (alongside the display name,
audio delay and room port), and a dialog opened from the watch-party panel's
help button, so nobody has to leave the player to find it.

It shows the hosting and joining paths side by side, because a person always
knows which of the two they are. Its wording tracks the actual button labels
("Start a room", "Copy invite", "Vote to resume", "Reachable anywhere") —
if you rename a control, update the guide with it.

## Where the code lives

| Path | Role |
| --- | --- |
| `src/shared/together/protocol.ts` | Wire contract, timeline maths, constants |
| `src/shared/together/clock.ts` | Offset estimation and slewing |
| `src/shared/together/drift.ts` | The correction ladder (pure, heavily tested) |
| `src/shared/together/room.ts` | Authoritative room rules — votes, gating, restrictions |
| `src/shared/together/mesh.ts` | Address reach classification and invite parsing (pure) |
| `src/main/together/mesh.ts` | Adapter scanning, winget install, ZeroTier join |
| `src/main/together/relay.ts` | WebSocket server around the room |
| `src/main/together/client.ts` | Socket client and clock discipline |
| `src/renderer/src/core/store/together.ts` | Store plus the drift control loop |
| `src/renderer/src/features/together/TogetherPanel.tsx` | Panel UI |
| `src/renderer/src/features/together/TogetherGuide.tsx` | The user-facing how-to |

The room rules and the sync maths are pure functions of `(state, event, now)`,
which is what lets `src/shared/together/*.test.ts` prove convergence and voting
behaviour without a network or a video element.
`src/main/together/integration.test.ts` then runs a real relay and real sockets
to check the maths is actually wired to the wire.
