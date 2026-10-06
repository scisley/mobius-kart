# Möbius Kart

An arcade kart racer on a see-through Möbius strip. Dreamed up by Ethan; the track is **Ethan's Loop**.

A Möbius strip has only one side, so each lap takes you around the loop twice: once on each face. The track is
semi-transparent, so you can see racers driving upside down beneath you, and you can **thump** the track to launch
them into the air.

Built for phones first, and plays on a laptop too. Made with [Three.js](https://threejs.org), TypeScript and
[Vite](https://vite.dev).

## How to play

You accelerate automatically; just steer. Tap **HOW TO PLAY** on the title screen for a quick guided tutorial.

| Action | Phone | Keyboard |
| --- | --- | --- |
| Steer | Tilt the phone like a steering wheel, or drag on the left side | ← → or A / D |
| Use item | ITEM | Space (or E) |
| Thump the kart below you | THUMP, or flick the phone up | Q |
| Bounce when you're thumped | THUMP as the bump hits | Q |
| Brake | BRAKE | ↓ or S |
| Sound on / off | Sound button (top left) | M |

- **Items:** drive through a glowing crystal. You'll get a turbo or an oil slick to drop behind you.
- **Thump:** when a kart is directly under you on the other face, a pink ring locks on. Thump to launch it.
- **Bounce:** when someone thumps you, thump right as the bump hits for big air and a turbo.
- **Slipstream:** stay mirrored with a kart on the other face and you both get a small speed boost.

Races are 3 laps against 7 racers. Watch out for Ethan: he's the fastest, and he hunts you.

## Run it locally

You need [Node.js](https://nodejs.org) 20.19 or newer.

```bash
npm install
npm run dev
```

Then open the `Local:` URL it prints (usually http://localhost:5173).

### On your phone

Tilt steering needs HTTPS, so there's a second dev server with a self-signed certificate:

```bash
npm run dev:phone
```

On a phone on the same Wi-Fi, open the `Network:` URL it prints (`https://<your-computer's-ip>:5174`). Accept the
certificate warning once, then tap RACE! and allow motion access. Play in landscape.

## Deploy

It's a static site. `npm run build` puts everything in `dist/`, which any static host can serve. For example, with
[Vercel](https://vercel.com):

```bash
npx vercel --prod
```

## More

[docs/DESIGN.md](docs/DESIGN.md) explains how it works: race coordinates on a one-sided surface, the thump physics,
the back-to-back starting grids, and ideas for future tracks.
