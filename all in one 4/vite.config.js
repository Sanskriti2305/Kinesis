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

export default defineConfig({
  plugins: [react(), basicSsl(), kinesisServices()],
  server: {
    // host:true exposes the dev server on the LAN so a phone can open it;
    // basicSsl() serves it over HTTPS, which WebXR requires off-localhost.
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      // Same-origin WebSocket for collaboration, so it works over wss:// on
      // the HTTPS page (a plain ws:// to the LAN would be blocked as mixed content).
      '/collab': { target: 'ws://localhost:8790', ws: true, rewrite: (path) => path.replace(/^\/collab/, '') },
    },
  },
});
