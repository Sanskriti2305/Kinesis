# Kinesis — Phase 2: 3D Workspace (+ live gesture bridge)

## What's in this folder

- **`Hand_tracking/`, `Assets/`** — Phase 1, hand tracking. Not touched, except
  one additive change explained below. See `Kinesis_Phase_1_Steps_to_Run.docx`
  for how to run the original Unity demo — that still works exactly as before.
- **`src/`, `index.html`, `vite.config.js`, `package.json`** — Phase 2, the
  React + Three.js 3D workspace. Model import (OBJ/STL), object tree,
  properties panel, and now Explode / Section / Measure tools.
- **`bridge/`** — new. A small relay that lets the browser receive the same
  gesture stream Unity gets, so the selected part in the 3D workspace can be
  moved/rotated/scaled by hand, live.

## The one change made to her Phase 1 code

`Hand_tracking/hand_tracker.py` now sends every packet to **two** UDP
destinations instead of one: Unity's port (`5051`, unchanged) and a new
`BRIDGE_PORT` (`5052`). That's the entire diff — two constants, one extra
`sock.sendto(...)` call. No tracking, classification, or gesture logic was
touched. Unity's receiver still only listens on `5051` and has no idea the
second send exists.

Why this was necessary rather than optional: a browser can't open a raw UDP
socket, and Unity already owns port `5051`, so something had to listen on a
different port and forward to the browser over WebSocket. That's `bridge/`.

## Running the full thing

Four things run side by side. Unity is optional — skip it if you only want
the browser demo.

**1. Gesture bridge relay** (new)
```
cd bridge
npm install
npm start
```
Leave this running. It listens for hand-tracker packets on UDP `:5052` and
forwards them to `ws://localhost:8765`.

**2. Hand tracker** (hers, unchanged usage)
```
cd Hand_tracking
pip install -r ../requirements.txt
python hand_tracker.py
```

**3. Unity** (hers, optional — only if you also want the original cube demo)
Open the Unity project in `Assets/`, press Play, per her steps-to-run doc.

**4. The 3D workspace** (new)
```
npm install
npm run dev
```
Open the printed localhost URL, click **Load Sample Assembly** (or import
your own `.obj`/`.stl`), **click a part to select it**, then use your hand:
- **MOVE** — nudges the selected part along the camera's right/up axes
- **SCALE** — grows/shrinks it, clamped to 0.2×–5× its size when selected
- **ROTATE** — rotates it to match your hand's orientation change

Gestures only ever act on whichever part is currently selected in the
workspace — mouse click-to-select and hand gestures share one selection,
they don't fight over it. Nothing moves if nothing is selected.

If you don't have the bridge/tracker running, the workspace still works
fully with mouse only — the gesture pill in the toolbar just reads
"relay offline" instead of "connected."

## Phase 2 tools

- **Explode** — slider, 0–100%. Spreads an assembly's top-level parts
  outward from its center. Disabled (reads "single part") for single-mesh
  STL imports, since there's nothing to separate.
- **Section** — pick an axis (X/Y/Z) and drag the offset slider to slice
  through the model and see inside it. This is a simple clipping plane —
  it hides geometry past the cut, it does not generate a capped/filled
  cross-section face. Good enough to look inside an assembly; not a
  substitute for real CAD sectioning.
- **Measure** — click two points on the model to get the straight-line
  distance between them, in the model's own units. Click a third point to
  start a new measurement.

## Known limitations worth knowing about

- Section has no cap geometry (noted above).
- Gesture MOVE/SCALE/ROTATE are frame-to-frame deltas, not absolute
  positions — smooth, but there's no "reset to origin" gesture; use the
  Properties panel or reload the model to reset a part you've moved.
- STEP import isn't implemented (matches the original Phase 2 spec — it
  needs a dedicated parser, e.g. `occt-import-js`, as a separate milestone).
