# Charity bin sim

A 3D simulation of a charity coin spiral funnel ("wishing well"): roll a coin in along the rim and it circles down, faster every lap, until it drops into the hole.

Live: https://charity-bin-sim.vercel.app

- Real UK coins (1p to £2) with their true diameter, mass and thickness; heavier, larger coins roll for longer.
- Four rim chutes with launch speed, aim and direction, plus flick-to-launch anywhere on the funnel.
- Feed coins continuously (Space, hold-to-pump, auto-feed); coins pass through each other.
- A predicted-path guide, fading trails, a coin pile and a running total.

## Physics

The funnel is a Plummer-softened potential, `z = -A / sqrt(r² + ε²)`, offset so the rim sits at z = 0. Each coin is a disc rolling on its edge over that surface: the Lagrangian in polar coordinates gives the radial equation, angular momentum is conserved apart from rolling resistance and air drag, and a coin that slows below a tipping speed falls flat and slides. Drag and rolling resistance are exaggerated so the differences between coins show within a minute.

## Credit

The surface, grid, trails and palette are adapted from the gravity well study in [mnove/kinetic](https://github.com/mnove/kinetic) (MIT).

## Development

```sh
pnpm install
pnpm dev      # http://localhost:3000
pnpm test
pnpm build
```
