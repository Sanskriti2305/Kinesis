# Kinesis — Phase 1 through Phase 6

Kinesis is an AI-powered spatial computing workspace built with React + Three.js, MediaPipe hand tracking, AI assistance, lightweight simulation, and WebSocket collaboration.

## Run the web workspace

From this `Phase4` folder:

```powershell
npm install
npm run dev
```

`npm run dev` now starts the Vite app **and automatically starts** the local AI service, collaboration server, and gesture WebSocket relay. You no longer need three separate Node terminals.

Open the printed Vite URL (normally `http://localhost:5173`).

## Phase 1 — Hand tracking

In another terminal, install Python dependencies once:

```powershell
python -m pip install -r requirements.txt
```

Then:

```powershell
cd Hand_tracking
python hand_tracker.py
```

Click **Enable Gestures** in Kinesis. The bridge is already running from `npm run dev`. Select a mesh first, then use:
- Pinch + hand movement → MOVE
- Four fingers open → SCALE
- Thumb + index pose → ROTATE

## Phase 2 — 3D workspace

- Load Sample Assembly
- Import OBJ/STL
- Select parts from the viewport or Object Tree
- Inspect properties
- Explode multi-part assemblies
- Section on X/Y/Z and move the section plane
- Measure two points

## Phase 3 — AI assistant

The AI panel works in local fallback mode without an API key and uses OpenAI function calling when `OPENAI_API_KEY` is configured. Try:
- `make it bigger by 20 percent`
- `make it smaller by 10 percent`
- `move it left`
- `rotate 30 degrees around Y`
- `explode the assembly`
- `enable X section`
- `measure this`
- `reset the part`

Voice uses the browser Web Speech API.

## Phase 4 — Simulation

The Live Simulation panel updates after model changes and exposes estimated mass, stress index, maximum stress, safety status, and a stress heatmap. It is a lightweight project/demo proxy, not certified FEA.

## Phase 5 — Five-agent orchestration

The orchestrator routes requests through:
1. Design Agent
2. Simulation Agent
3. Analysis Agent
4. Material Agent
5. Documentation Agent

Agent-chain badges appear in the AI panel. Material and documentation requests also work in local fallback mode.

## Phase 6 — Live collaboration

The collaboration server runs automatically with `npm run dev`. On two laptops, the server host must be reachable over the LAN and the second laptop should set `VITE_COLLAB_URL=ws://<HOST-LAN-IP>:8790` before starting Vite. Use the same room code on both clients. Selection and transforms are synchronized; the shared sample-model URL can also be loaded by a joining client.

## Quest 3S

Use **🥽 Quest 3S** to request an immersive WebXR session. Desktop browsers without a compatible XR device show a clear unsupported message.
