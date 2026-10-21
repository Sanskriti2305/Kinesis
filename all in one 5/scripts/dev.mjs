// Starts both dev servers:
//   http://<ip>:5173   normal access (+ backend services)  — use for viewing / desktop
//   https://<ip>:5174  secure context for WebXR            — use for Quest VR and Android AR
import { spawn } from 'node:child_process';
import path from 'node:path';

const vite = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
const run = (args) => spawn(process.execPath, [vite, ...args], { stdio: 'inherit' });

const children = [
  run(['--port', '5173', '--strictPort']),
  run(['--mode', 'https', '--port', '5174', '--strictPort']),
];
const stop = () => { for (const c of children) { try { c.kill(); } catch {} } };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(0); });
children.forEach((c) => c.on('exit', () => { stop(); process.exit(0); }));
