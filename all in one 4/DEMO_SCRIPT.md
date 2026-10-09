# Kinesis — Demo Script

This is a run sheet, not marketing copy. It exists so a live demo has a
fixed order and a named fallback for every step that depends on hardware
you may not fully control in the room (webcam angle, WiFi, a second
laptop, a VR headset, an Android phone). If a step fails, say what it
would have shown and move to the next one — don't stall on it.

Rehearse this end-to-end at least once, in the actual room, on the
actual WiFi, before presenting it live. Nothing below substitutes for that.

## 0. Before anyone walks in

- [ ] `npm run dev` running, printed URL open, model loads with **Load
      Sample Assembly**
- [ ] Second laptop (or a phone) on the same WiFi, reachable at
      `http://<host-LAN-IP>:5173`, for the Phase 6 collaboration step
- [ ] If demoing Phase 7: an Android phone with Chrome, ARCore installed
- [ ] If demoing Phase 8: Quest 3S charged, hand tracking enabled in
      the headset's system settings, Quest Link/Air Link connected or
      Quest Browser open to the same URL
- [ ] `python hand_tracker.py` running, webcam has a clear view of your
      hand against a plain background, room lighting isn't backlit
- [ ] `OPENAI_API_KEY` set if you want live LLM answers — otherwise
      say so and demo the local fallback mode, which still works

## 1. Phase 1–2 — Load a model, browse it (1 min)

Load the sample assembly. Click a part in the viewport, then click a
different one in the Object Tree — same selection, two entry points.
Run Explode, then Section on X, then Measure two points.

**If the model fails to load:** say what format it is (OBJ/STL) and
load a smaller backup file instead of debugging live.

## 2. Phase 1 — Hand gestures (1–2 min)

Click **Enable Gestures**. Select a part first — gestures only ever
act on the current selection, same as every other input path in this
app. Pinch and move → MOVE. Open your hand → SCALE. Thumb+index pose →
ROTATE.

**If gesture tracking is flaky:** it's almost always lighting or hand
distance from the webcam, not the code — back up, get better light on
your palm, and say so out loud rather than fighting it silently.

## 3. Phase 3 — AI assistant (1–2 min)

Type or say: *"make it bigger by 20 percent"*, then *"rotate 30
degrees around Y"*. Point out the explanation text, not just the
transform — the differentiator here is that it explains itself.

**If the API key isn't set:** say "local fallback mode" out loud once
and keep going — it still resolves the same commands.

## 4. Phase 4 — Live simulation (30 sec)

Toggle the heatmap on. Reshape or move a part with a gesture or the AI
panel and point at the stress number changing in real time. Say
explicitly that this is a lightweight demo proxy, not certified FEA —
don't let anyone read more into that panel than it claims.

## 5. Phase 5 — Multi-agent orchestration (1 min)

Ask something that needs more than one agent, e.g. *"optimize this
part for weight"* or ask for a material recommendation. Point at the
agent-chain badges in the AI panel as each one lights up — that
sequence, not the final answer alone, is what Phase 5 built.

## 6. Phase 6 — Live collaboration (1–2 min)

On laptop 2 (or the phone, in a regular browser tab, not AR yet), open
the app, join the same room code. Move a part on laptop 1, point at it
updating on laptop 2 with no page refresh.

**If WiFi drops mid-demo:** the collaboration panel will now retry on
its own for about 12 seconds (Phase 9 added this — it used to just die
silently). If it's still showing "offline" after that, say collab is
degraded and keep going on one laptop; don't lose the whole demo to a
router hiccup.

## 7. Phase 7 — AR mobile companion (1–2 min)

On the phone, in the **same collaboration room**, tap **📱 AR**. Point
the phone at a table or floor until the teal ring (hit-test reticle)
appears, tap to place. Walk around it. Use two fingers to scale it to
roughly real size, one finger to drag it, two-finger twist to rotate.
Tap **Exit AR** (the on-screen button, not the browser back button) to
leave the session cleanly.

**This is the least field-tested phase in the build** — hit-test and
dom-overlay behavior vary across Android/Chrome versions. Test on the
actual demo phone beforehand. If AR won't start, say the browser or
device doesn't support it here and move on — don't debug WebXR
permissions live.

## 8. Phase 8 — VR headset mode (1–2 min)

Click **🥽 Quest 3S** (or open the app directly in the Quest Browser).
Put the headset on. With hand tracking enabled on the device, pinch
and move one hand to move+rotate the selected part, pinch with both
hands and pull apart/together to scale.

**This is the second-least field-tested phase** — I wrote it against
the WebXR Hand Input spec but have not run it on a physical Quest 3S.
Rehearse this specifically, more than once, before presenting it. If
hand tracking isn't picked up, check the headset's own hand-tracking
setting first — that's the most common cause, not the app.

## 9. Close (30 sec)

One sentence: gestures, AI, simulation, multi-agent orchestration,
collaboration, AR, and VR are one shared scene graph and one set of
manipulation primitives (`translateSelectedBy` /
`rotateSelectedByDelta` / `scaleSelectedByFactor`) — not seven separate
demos stitched together. That's the actual engineering claim; make it
explicitly instead of hoping the audience infers it.

## If something breaks mid-demo

The top-level error boundary now has a **Reload Kinesis** button
(Phase 9) that resets the page without losing your running background
servers (gesture bridge, collab server, AI server). Use it once. If the
same error comes right back, stop and move to the next phase — don't
troubleshoot code live in front of an audience.
