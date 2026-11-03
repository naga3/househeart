import { defineConfig } from 'vite';

// The dev server listens on localhost only; it is opened from a phone through Tailscale
// (`tailscale serve`, as yorube's "スマホで開く" does), under this machine's ts.net name.
// The port is fixed at 15130 (~/src/etc/PORTS.md).
const viaTailscale = { port: 15130, strictPort: true, allowedHosts: ['.ts.net'] };

export default defineConfig({ base: './', server: viaTailscale, preview: viaTailscale });
