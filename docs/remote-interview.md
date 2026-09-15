# Running a live elicitation with a remote expert

How to let someone on a video call talk to chatgraph, with the session
recorded. Written for a specific case — interviewing an airline
operations expert over Zoom — but the mechanics are general.

**The whole problem is audio routing.** chatgraph reads a capture device
and writes to a playback device; it does not know or care that the human
is remote. The work is making the remote party's voice arrive at
chatgraph's input, and chatgraph's voice arrive at the conferencing
app's input, **without the two feeding back into each other.**

## The decision: run it on your machine, not theirs

Keep every failure mode on your side of the call.

The alternative — giving the expert a browser link — is worse for this
purpose. `web/` reimplements the agent and extractor in TypeScript and
stores its graph in browser IndexedDB; **it is not a client of this
backend** and making it one is the work tracked in issue #4, not a
week's job. It would also mean their corporate network, their browser,
their IT policy, and their screen share all having to work, on a call
you get one shot at.

Running locally costs you one routing setup, which you can test in
advance and fix yourself.

## What you need

- **A virtual audio device.** macOS has no loopback by default.
  - [BlackHole](https://existential.audio/blackhole/) — free, 2ch build
    is enough (`brew install blackhole-2ch`).
  - [Loopback](https://rogueamoeba.com/loopback/) — paid, but its UI
    makes multi-device routing much less error-prone. Worth it if the
    session matters and you are short on time.
- **A local screen recorder** — QuickTime (Cmd-Shift-5) or OBS. **Do not
  rely on Zoom's cloud recording:** it compresses audio and may not
  capture routed streams at all.
- **Headphones.** Non-negotiable. Open speakers will feed chatgraph's
  own voice back into the call.

## The routing

Four streams, and each must reach exactly one place:

```
  Expert speaks  ──Zoom──>  Zoom output  ──virtual cable──>  chatgraph input
  chatgraph TTS  ──────────────────────>  Zoom mic input  ──Zoom──>  Expert hears
  Everything     ──────────────────────>  your headphones (monitoring)
  Screen + audio ──────────────────────>  local recording
```

**The trap:** chatgraph's TTS must reach Zoom's *microphone* input so
the expert hears it — but Zoom's microphone must not also pick up its
own output, or the expert hears themselves and chatgraph hears itself.
Headphones plus a correctly scoped virtual device solve this; open
speakers do not.

### With BlackHole (free)

1. Install: `brew install blackhole-2ch`, then restart Zoom.
2. In **Audio MIDI Setup**, create a **Multi-Output Device** containing
   *BlackHole 2ch* + your headphones. This lets you hear what is being
   routed.
3. **Zoom → Settings → Audio:** Speaker = *Multi-Output Device*,
   Microphone = *BlackHole 2ch*.
4. **chatgraph:** input = BlackHole (so it hears the expert via Zoom's
   output), output = BlackHole (so Zoom transmits its voice).

Because both directions share one cable, **check for self-hearing
immediately** in the rehearsal. If chatgraph transcribes its own speech,
use two separate virtual devices (BlackHole 2ch *and* 16ch) — one per
direction — or switch to Loopback.

### With Loopback (recommended if buying is an option)

Create two virtual devices — *To Chatgraph* (source: Zoom) and *From
Chatgraph* (source: chatgraph, used as Zoom's mic). Separate cables
eliminate the self-hearing class of bug entirely. Worth the licence
given the timeline.

## Pinning the devices

Find the indices:

```bash
chatgraph --list-audio-devices
```

Then name them explicitly rather than trusting the system default:

```bash
chatgraph aviation --audio-input "BlackHole" --audio-output "BlackHole"
```

**Why this matters.** Before this option existed, chatgraph used the
system default, so plugging in headphones or joining a call could
silently redirect capture mid-session. Naming the device removes that
failure mode. An index or any part of the device name both work.

## Rehearsal — do not skip this

**Test with a second person, not alone.** Solo testing cannot surface
echo or self-hearing, which are the two failure modes that actually
occur. Fifteen minutes with a colleague on a real call is enough.

Checklist:

- [ ] Expert's voice appears in the chatgraph transcript
- [ ] Expert hears chatgraph's replies
- [ ] chatgraph does **not** transcribe its own speech
- [ ] Expert does not hear themselves echoed
- [ ] Barge-in works — interrupting mid-reply cuts playback
- [ ] Screen recording captures **both** voices, not just yours
- [ ] Gremlin is up and the graph visibly updates during the call
- [ ] Recording keeps running for the full planned duration

## Running the session

1. **Start Gremlin Server first**, and confirm chatgraph connects.
   Decide beforehand whether to run `--fresh`.
2. **Start the recorder before the call**, not after it begins.
3. **Ask permission to record, on the recording**, and say where it will
   be used. If it is going into a masterclass, that consent belongs in
   the artefact.
4. **Share your screen** so the expert sees the graph forming. That
   visible feedback is a large part of what makes the demo land.
5. **Watch the transcript, not the expert.** Mis-transcriptions are the
   usual failure, and you can correct course immediately.

## Fallbacks, in order

1. **Text instead of voice.** The whole audio problem disappears; the
   elicitation still works. **Use this for a first scenario-honing
   session** — lower risk and easier to steer.
2. **Expert on speakerphone**, into your laptop mic. Crude, no routing
   needed, and surprisingly serviceable if audio quality is not the
   point.
3. **Record separately and interview by hand**, transcribing into
   chatgraph afterwards. Loses the live magic, keeps the content.
4. **Interview yourself** on a domain you genuinely know. Not as
   compelling as a real expert, but it is a real elicitation rather than
   a scripted one — and it is fully under your control.

## Two things worth deciding in advance

**Have a text fallback ready to switch to mid-session.** If routing
fails at minute three, moving to typed input keeps the hour productive
instead of losing it to debugging.

**The recording is the deliverable.** If the audio is unusable, the
interview still has value as scenario input — but say so at the time
rather than discovering it later.
