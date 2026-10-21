import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { spawn } from 'node:child_process';

function kinesisServices() {
  const children = [];
  return {
    name: 'kinesis-local-services',
    configureServer(server) {
      const spawnService = (label, file, env = {}) => {
        const child = spawn(process.execPath, [file], { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: 'inherit', windowsHide: true });
        child.on('error', (err) => console.error(`[kinesis] ${label} failed: ${err.message}`));
        children.push(child);
      };
      spawnService('AI service', 'ai/server.js', { AI_PORT: '8787' });
      spawnService('collaboration service', 'collaboration/server.js', { COLLAB_PORT: '8790' });
      spawnService('gesture bridge', 'bridge/server.js', { GESTURE_UDP_PORT: '5052', GESTURE_WS_PORT: '8765' });
      const stop = () => { for (const child of children) { try { child.kill(); } catch {} } };
      server.httpServer?.once('close', stop);
    },
  };
}

// Two dev servers run side by side (see scripts/dev.mjs):
//   default mode  -> plain http  on :5173, also starts the backend services
//   --mode https  -> https       on :5174, for WebXR (VR/AR need a secure context off-localhost)
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [kinesisServices()])],
  server: {
    host: true, // reachable from other devices on the LAN
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      // Same-origin WebSocket for collaboration, so it works over wss:// on
      // the HTTPS page (a plain ws:// to the LAN would be blocked as mixed content).
      '/collab': { target: 'ws://localhost:8790', ws: true, rewrite: (path) => path.replace(/^\/collab/, '') },
    },
  },
}));
