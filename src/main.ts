import './style.css';
import { SoundSystem } from './audio';
import { Game } from './game';
import { Hud } from './hud';
import { Input } from './input';

const input = new Input();
if (input.isTouch) document.body.classList.add('touch');

const hud = new Hud();
hud.setVisible(false);
const sound = new SoundSystem();
const game = new Game(document.getElementById('app')!, input, hud, sound);

// Browsers only allow audio after a user gesture, so start it on the first touch, click or key.
const unlock = () => sound.init();
for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, unlock, { once: true, capture: true });

const soundBtn = document.getElementById('sound')!;
const SOUND_LABEL = { all: '♪ MUSIC + SFX', sfx: '♪ SFX ONLY', off: '♪ MUTED' };
const showSoundMode = () => {
  soundBtn.textContent = SOUND_LABEL[sound.mode];
  soundBtn.classList.toggle('off', sound.mode === 'off');
};
const cycleSound = () => {
  sound.init();
  sound.cycleMode();
  showSoundMode();
};
showSoundMode();
soundBtn.addEventListener('click', cycleSound);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) cycleSound();
});

if (import.meta.env.DEV) Object.assign(window, { game });

const title = document.getElementById('title')!;
const results = document.getElementById('results')!;
const list = document.getElementById('results-list')!;
const resultsNote = document.getElementById('results-note')!;

// ---------- Steering mode (touch devices) ----------

const steerBtn = document.getElementById('steer-mode')!;
const steerNote = document.getElementById('steer-note')!;
const steerHint = document.getElementById('steer-hint')!;
let tiltRequested = false;

function showSteerMode() {
  steerBtn.textContent = input.tiltWanted ? 'STEERING: TILT' : 'STEERING: TOUCH';
  steerNote.textContent = input.tiltWanted
    ? window.isSecureContext
      ? 'Hold the phone like a steering wheel. Tap the left side to re-center.'
      : 'Tilt needs the HTTPS dev server (npm run dev:phone). Drag steering until then.'
    : 'Drag the left side of the screen to steer.';
}
showSteerMode();
steerBtn.addEventListener('click', () => {
  input.setTiltWanted(!input.tiltWanted);
  showSteerMode();
});
input.onRecenter = () => hud.flash('CENTERED', 0.6, true);

function updateSteerHint() {
  const tilting = input.usingTilt;
  document.body.classList.toggle('tilt', tilting);
  const text = tilting
    ? 'tilt to steer · tap to re-center · flick up to thump'
    : input.tiltWanted && tiltRequested
      ? 'tilt unavailable · drag to steer'
      : 'drag to steer';
  if (steerHint.textContent !== text) steerHint.textContent = text;
}

/** Shared setup for a race or the tutorial: runs inside the tap, so audio and motion access can start. */
function enterPlay(tutorial: boolean) {
  sound.init();
  // Ask for motion access straight from the tap: iOS only prompts during a user gesture.
  if (input.isTouch && input.tiltWanted) {
    tiltRequested = true;
    void input.tilt.request();
  }
  title.classList.add('hidden');
  results.classList.add('hidden');
  document.body.classList.add('racing');
  document.body.classList.toggle('tutorial', tutorial);
  hud.setVisible(true);
  if (input.isTouch) {
    // Best effort: fullscreen + landscape where the browser allows it (Android Chrome).
    document.documentElement.requestFullscreen?.().catch(() => {});
    (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {});
  }
}

function start() {
  enterPlay(false);
  game.startRace();
}

function startTutorial() {
  enterPlay(true);
  game.startTutorial();
}

function showTitle() {
  document.body.classList.remove('racing', 'tutorial');
  hud.setVisible(false);
  results.classList.add('hidden');
  title.classList.remove('hidden');
}

game.onTutorialExit = (to) => {
  if (to === 'race') start();
  else showTitle();
};

game.onFinish = (rows) => {
  const me = rows.findIndex((r) => r.me);
  const ethan = rows.findIndex((r) => r.name === 'Ethan');
  resultsNote.textContent =
    me < ethan ? 'You beat Ethan!' : ethan === 0 ? 'Ethan wins this one.' : 'Ethan beat you. Rematch?';
  document.body.classList.remove('racing');
  hud.setVisible(false);
  list.innerHTML = rows
    .map(
      (r, i) => `<li class="${r.me ? 'me' : ''}">
        <span class="rank">${i + 1}</span>
        <span class="dot" style="background:#${r.color.toString(16).padStart(6, '0')}"></span>
        <span class="name">${r.name}</span>
        <span class="t">${r.time}</span>
      </li>`,
    )
    .join('');
  results.classList.remove('hidden');
};

document.getElementById('start')!.addEventListener('click', start);
document.getElementById('again')!.addEventListener('click', start);
document.getElementById('how-to')!.addEventListener('click', startTutorial);

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.tick(dt);
  hud.setSteer(input.steer);
  updateSteerHint();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
