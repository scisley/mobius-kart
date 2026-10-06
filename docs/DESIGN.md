# Möbius Kart: design notes

How the game works under the hood, and where future ideas plug in. For playing and running it, see the
[README](../README.md).

## Thump and trampoline

The track has no thickness, so a kart slamming down on one face pushes up a bulge on the other face, right under
whoever is mirrored opposite you at `(s + L/2, -v)`. When a kart is in range, a pink lock-on ring appears around it
(through the floor) and the THUMP control glows. A thumped kart is thrown into the air out of control and loses
speed when it lands. If you're the one being thumped, you get a warning: press **THUMP** as the bulge hits
(up to 0.4s early or 0.2s late). Your hop gets caught by the bulge and you ride it for **BIG AIR** and a turbo
instead, with no slam of your own, and your thump charge is refunded. Thumps have a 5s cooldown, which starts
empty, so nobody can thump until 5s after GO. The AI uses them too.

## Two grids, hunters and slipstream

Opposite karts are half a lap apart, so a single bunched pack would almost never meet itself. Instead the
8 karts start in **two grids of four, back to back on the same patch of track**: grid A behind the checkered line
on face A, grid B behind the yellow halfway band on face B, which is physically the underside of the same spot.
Each grid races 3 laps from its own line, under its own finish gantry. Placings use distance raced, not physical
position. On the minimap your grid are solid dots and the other grid are rings.

- **Hunters** (Pip in grid A, Ethan in grid B) adjust their speed by up to ±8% to stay opposite a kart on the
  other face, preferring you, and thump more eagerly.
- **Antipode slipstream:** any two karts mirrored across the sheet both build up to a +6% top-speed bonus over 1s.
  You see a cyan beam through the floor and the SLIPSTREAM badge fills. Staying opposite each other pays off,
  which sets up more thumps.

In a simulated race, about 40% of karts are mirrored in the first 15s, settling to 15–25%. The same race from a
single grid gives zero encounters.

The bump function lives in `src/thump.ts` and runs in two places: in the track's vertex shader to deform the sheet,
and on the CPU for kart physics.

## Race coordinates

Everything lives in **race coordinates** `(s, v)`. `s` is arc length along the centre line and `v` is the
sideways offset. Kart physics, AI, items and collisions are all 2D. `MobiusTrack.sample(s, v, h)` maps a
point into 3D and returns the local frame (forward `T`, across `A`, normal `N`).

Because the strip is one-sided, getting back to the start on the same face takes two trips round the loop.
So one lap is `s ∈ [0, L)`, and the point physically on the other side of `(s, v)` is `(s + L/2, -v)`. The
HUD's SIDE A / SIDE B shows which half of the lap you're on.

Other pieces:

- **Steering on the surface.** The physics uses the centre line's geodesic curvature `κ`. Flat sections of
  the strip are real corners and on-edge sections are straights. Inside lanes really are shorter.
- **Track rendering.** The mesh covers only half a lap. The fragment shader uses `gl_FrontFacing` to decide
  which half of the race a pixel belongs to, so each face gets its own decoration. The checkered finish line's
  back side is the yellow "halfway" band.
- **Transparency.** The track draws after the opaque karts with depth writes off, so karts on the far face
  show through the floor.
- **The rail.** It's a single tube, because a Möbius strip has only one edge.

| File | What's in it |
| --- | --- |
| `src/track.ts` | Möbius geometry, arc-length tables, track shader, rail |
| `src/kart.ts` | Kart model, physics, boost, thump hops |
| `src/ai.ts` | AI drivers |
| `src/items.ts` | Item crystals, boost pads, slicks |
| `src/thump.ts` | Sheet deformation shared by shader and physics |
| `src/scenery.ts` | Sky, stars, Klein bottles |
| `src/game.ts` | Race flow, camera, collisions |
| `src/hud.ts`, `src/input.ts` | HUD/minimap, touch + keyboard |
| `src/tilt.ts` | Tilt steering and flick-to-thump from the motion sensor |
| `src/audio.ts` | Synthesized music loop, engine hum and sound effects (Web Audio, no files) |

## Future ideas and where they plug in

- **Cut-down-the-middle track:** this gives one strip twice as long with two full twists. Generalize
  `frameAtT` so the twist is `k·t/2` and the parameter range scales. Everything else works on `(s, v)` already.
- **Undulating strip:** deform in the vertex shader and in `sample()` with the same time-varying function.
- **Holes to the other side:** teleport `(s, v) → (s + L/2, -v)`.
- **More items, more tracks:** not started.
