# Evosim

A single-page evolution simulator. The world generator is in place; the simulation itself is still to be designed.

**Stack:** React + Vite + Tailwind CSS

## World generation

`src/worldgen/` holds the procedural map generator: a seeded Perlin fBm island
with verified lake carving (`mapgen.js`, framework-agnostic), and the
Home → Settings → Game screens that drive it. Every "Play" rolls a new
coastline; Settings controls map size, noise detail/feature size/roughness,
lake count range, and vegetation density, persisted to `localStorage`.

## Development

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Build

```bash
npm run build
npm run preview
```

## Deploy (Render)

Deployed as a Render **Static Site**, same pattern as [Traveleria](https://github.com/chezer1234/Traveleria):

1. Go to https://dashboard.render.com and click **New → Static Site**
2. Connect the `Evosim` GitHub repo
3. Configure:
   - **Branch:** `main`
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`
4. Click **Create Static Site**

Every push to `main` triggers a new deploy automatically once the service is connected.

## Status

World/map generation is done. No creatures, evolution, or simulation logic yet.
