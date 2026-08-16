import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Honor an externally-assigned port (e.g. from a dev tool that probes
    // for a free port itself) instead of Vite's own 5173->5174->... bump,
    // which would otherwise land on a port nothing outside this process knows about.
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
})
