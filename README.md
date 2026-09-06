# jelly.

A small, tactile jelly playground inspired by [Scott's experiment](https://x.com/scottstts/status/2096008241104711698). Built with TypeScript, Three.js, and Vite.

## Run

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. `npm run build` checks TypeScript and creates a production build in `dist`. `npm run preview` serves that build. `npm test` runs the physics checks. The build retains prior output files.

## Deploy to Cloudflare

The static site is configured in `wrangler.jsonc` for `jelly.angelrod.dev`. Authenticate with the Cloudflare account that owns `angelrod.dev`, then deploy:

```sh
npx --yes --package=node@22 --package=wrangler@4.129.0 wrangler login
npm run deploy
```

Wrangler publishes the static assets and manages the custom-domain association and certificate. It runs under a separate Node.js 22 runtime, so the local app can still run on Node.js 18. No Cloudflare credentials are stored in the repository. Deploy from a fresh checkout to upload only the current build's assets.

## Play

- Switch between the classic jelly mold, a gummy bear, and a jello cube with softly rounded edges. Your flavor, sliders, and motion settings carry over; switching shapes settles the new shape into its starting pose.
- Click or tap the jelly to poke it. Drag it to stretch, then release.
- Drag the empty background to rotate the view.
- Choose raspberry, peach, mint, or layered rainbow; adjust squishiness and bounciness.
- Give it a wobble, slow time, or pause. Reset restores the default flavor and controls while keeping the chosen shape.
- Focus the scene and press Space or Enter for a keyboard wobble.

Reduced-motion preferences start the simulation paused. Wobble or Resume starts it explicitly.

## How it works

`src/physics.ts` implements a CPU-based extended position-based dynamics (XPBD) deformation cage with 216 particles and 750 tetrahedra, sized for the selected shape. Edge constraints provide elasticity; signed-volume constraints resist collapse. Floor contact, internal damping, and a weighted grab constraint control motion. The closed, 16-flute ring mold in `src/mold.ts` follows the particles using trilinear skinning, and normals update with the shape. Its center opening is part of the surface geometry; the simulation uses the enclosing cage. `src/bear.ts` uses Three.js marching cubes to join rounded ears, head, belly, paws, and molded facial details into one closed surface, avoiding overlapping refractive shells. Rainbow bands use rest-space height so they stretch with either shape.

`src/cube.ts` creates a rounded cube with subdivided faces so its broad sides can flex, not just its corners. Shared vertices keep its surface closed during deformation. All three shapes use the same material and rest-space rainbow layers, with shape-specific framing and approximate optical thickness.

`src/main.ts` renders the result with Three.js `WebGPURenderer` and a physical node material: full transmission, refraction, colored absorption, and a smooth wet surface. Three rectangular softboxes provide warm key, cool fill, and rim lighting, with matching reflection cards in the studio environment. An aligned spotlight supplies a filtered, colored shadow of the deforming mold. The opaque floor shader includes the grid so it can appear in refraction. WebGPU is preferred; Three.js falls back to WebGL 2 when needed. Add `?renderer=webgl` to verify the fallback. The status indicator reports the actual active backend. Graphics acceleration is required; WebGPU requires a secure context (HTTPS or localhost).

Optical wall thickness and shadow tint are approximations; this uses screen-space refraction and shadow maps, not ray-traced caustics. This is a visual soft-body experiment, not a scientific material model, GPU compute simulation, or path tracer. There are no runtime API keys or external services. Google Fonts is optional; local system fonts are the fallback.
