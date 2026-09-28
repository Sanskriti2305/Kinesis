# Kinesis — QA Checklist (Phase 9)

Nothing on this list has been run by me — I don't have a Quest 3S, an
ARCore Android phone, or a second physical machine on a shared WiFi in
this environment. This is the checklist to actually work through
yourself before the demo, not a report that it already passed.

Check off each box only after you've done it, not after reading it.

## Regression — phases 1–6 still work after the Phase 7–9 changes

The main behavioral change from this round is `renderer.xr.enabled =
true` in `SceneManager`'s constructor and the animation-loop callback
switching from a fixed function to `(time, frame) => {...}`. Neither
should affect non-XR use, but verify:

- [ ] Load sample assembly, orbit/pan/zoom with mouse — unaffected by
      the XR changes
- [ ] Explode / Section / Measure tools all still work
- [ ] Webcam gestures (MOVE/SCALE/ROTATE) still work with the bridge
      running
- [ ] AI assistant still resolves a command and shows an agent chain
- [ ] Simulation panel and heatmap still update on transform
- [ ] Two-laptop collaboration still syncs selection and transforms
- [ ] **Specifically retest the collaboration reconnect**: join a room
      on two laptops, kill the collab server process, wait, restart it
      — confirm the status pill goes connecting → connected again
      within ~12 seconds without either client needing a page refresh

## Phase 7 — AR

- [ ] `immersive-ar` actually starts on your demo phone/browser (Chrome
      on Android with ARCore; iOS Safari does not support WebXR AR as
      of this writing — confirm your target device before assuming
      this works)
- [ ] Hit-test reticle appears on a real surface within a few seconds
      of pointing the phone at it
- [ ] Tap places the model at the reticle position, not somewhere else
- [ ] Model is a sensible real-world size after placement (it's scaled
      to ~0.5 m on its longest side by default — adjust
      `SceneManager._setupArAnchor`'s `0.5` constant if your assembly
      should default to a different real-world size)
- [ ] One-finger drag repositions the model without it jumping
- [ ] Two-finger pinch scales smoothly in both directions
- [ ] Two-finger twist rotates around Y without also scaling
- [ ] **Exit AR** button in the overlay actually ends the session and
      the desktop view resumes correctly (model still selectable,
      still responds to mouse/gestures)
- [ ] Backing out via the phone's own AR UI / back gesture (not our
      Exit button) still cleans up correctly — `_teardownAr` needs to
      run either way; confirm the app isn't left in a broken state
- [ ] Joining the same collaboration room on the phone before entering
      AR actually pulls down the model that's loaded on the desktop
      (this is the "model sync" requirement — it rides on Phase 6's
      existing `onRemoteModel`, so if Phase 6 collab sync is broken,
      this will be too)

## Phase 8 — VR hand tracking

- [ ] `immersive-vr` starts and you actually see the scene in the
      headset (this is the bug I fixed — `renderer.xr.enabled` was
      never set — so specifically confirm you're not looking at a
      blank/frozen view)
- [ ] Hand tracking is enabled in the Quest's own OS settings, not just
      requested by the page — if the headset itself has hand tracking
      off, the `hand-tracking` optional feature request will silently
      have no hands to read
- [ ] Select a part before putting the headset on (there is currently
      no in-headset way to select a part — that's a real gap, see
      "Known gaps" below), then confirm one-hand pinch+move
      moves+rotates it
- [ ] Two-hand pinch scales it, and scaling stops cleanly when you
      release one hand
- [ ] Pinch threshold (`_xrPinchThreshold = 0.028` metres in
      `SceneManager.js`) is a guess — if pinch detection feels too
      sensitive or not sensitive enough on your actual hands, adjust
      this constant and retest rather than assuming it's tuned
- [ ] Exiting VR (headset's own exit gesture) leaves the desktop view
      in a working state afterward

## Phase 9 — polish

- [ ] Trigger a deliberate render error (e.g. temporarily throw inside
      a component) and confirm the **Reload Kinesis** button actually
      recovers without a full page refresh
- [ ] Confirm the collaboration status pill shows a distinct state
      after `MAX_RECONNECT_ATTEMPTS` is exhausted (renders as literal
      text "failed", now with dedicated red styling)

## Known gaps — don't demo around these, just don't claim them

- **No in-headset part selection.** VR hand gestures only manipulate
  whatever was selected on the desktop before you put the headset on.
  Building a hand-raycast selection for VR is a reasonable next step,
  not something silently included here.
- **AR real-world scale is a fixed guess** (0.5 m longest side), not
  derived from any unit metadata in the OBJ/STL file — those formats
  generally don't carry real-world scale at all, so this is a
  reasonable default, not a real measurement.
- **Nothing here has been performance-profiled.** "Bug fixes and
  performance optimization" was in the Phase 9 plan; only the two
  concrete bugs above got fixed. If the frame rate drops with a large
  assembly loaded, that hasn't been investigated.
