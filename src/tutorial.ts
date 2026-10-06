import type { Input } from './input';
import type { Kart, KartEvent } from './kart';

/** What the tutorial needs from the game. */
export interface TutorialHost {
  player: Kart;
  /** Ethan: joins partway through as a scripted partner on the other face. */
  partner: Kart;
  trackLength: number;
  input: Input;
  setPartnerActive(on: boolean): void;
  celebrate(): void;
  flash(text: string): void;
  exit(to: 'race' | 'title'): void;
}

interface Step {
  title: string;
  /** Short explanation of the idea. */
  text: () => string;
  /** The explicit instruction: what to do right now. Can change as the step progresses. */
  todo: () => string;
  /** Info steps advance with the Next button instead of a task. */
  info?: boolean;
  final?: boolean;
  enter?: () => void;
  /** Return true once the task is done. */
  update?: (dt: number) => boolean;
  event?: (k: Kart, e: KartEvent) => void;
}

const $ = (id: string) => document.getElementById(id)!;
const CELEBRATE_SECONDS = 1.3;

/**
 * Guided walkthrough on the real track. Each step tells you exactly what to do and waits until you
 * do it. Ethan is pinned to the mirror point under you so the other-face moves can be practised.
 */
export class Tutorial {
  private readonly steps: Step[];
  private index = 0;
  private celebrating = 0;
  private done = false;
  private partnerOn = false;
  /** Only the "Bounce" step lets Ethan thump. */
  private partnerMayThump = false;

  // Per-step scratch state.
  private leftTime = 0;
  private rightTime = 0;
  private itemUsed = false;
  private eventDone = false;
  private missed = false;
  private thumpTimer = 0;
  private waitingThump = 0;

  private readonly card = $('tutorial');
  private readonly stepEl = $('tut-step');
  private readonly titleEl = $('tut-title');
  private readonly textEl = $('tut-text');
  private readonly todoEl = $('tut-todo');
  private readonly nextBtn = $('tut-next');
  private readonly skipBtn = $('tut-skip');
  private readonly raceBtn = $('tut-race');
  private readonly menuBtn = $('tut-menu');
  private readonly listeners: [HTMLElement | Window, string, EventListener][] = [];

  constructor(private readonly host: TutorialHost) {
    const { player, partner, input } = host;
    const ctrl = (tilt: string, touch: string, keys: string) =>
      input.usingTilt ? tilt : input.isTouch ? touch : keys;
    const thumpHow = () => ctrl('tap THUMP (or flick your phone up)', 'tap THUMP', 'press Q');
    const next = () => ctrl('tap NEXT', 'tap NEXT', 'press Enter');

    this.steps = [
      {
        title: "Welcome to Ethan's Loop",
        info: true,
        text: () =>
          'This track is a Möbius strip: a loop with a half twist, so it only has one side. ' +
          'Your kart drives forward by itself.',
        todo: () => `👉 ${cap(next())} to start.`,
      },
      {
        title: 'Steer',
        text: () => 'You only need to steer. Speed is automatic.',
        enter: () => {
          this.leftTime = this.rightTime = 0;
        },
        todo: () =>
          this.leftTime < 0.25
            ? `👉 Steer LEFT now: ${ctrl('rotate your phone to the left', 'drag left on the left side of the screen', 'hold ← (or A)')}.`
            : `👉 Now steer RIGHT: ${ctrl('rotate your phone to the right', 'drag right', 'hold → (or D)')}.`,
        update: (dt) => {
          if (this.leftTime < 0.25) {
            if (input.steer < -0.4) this.leftTime += dt;
          } else if (input.steer > 0.4) {
            this.rightTime += dt;
          }
          return this.rightTime > 0.25;
        },
      },
      {
        title: 'Items',
        text: () => 'Glowing crystals on the track give you an item, shown at the top of the screen.',
        enter: () => {
          this.itemUsed = false;
        },
        todo: () =>
          player.item
            ? `👉 You got a turbo! ${ctrl('Tap ITEM', 'Tap ITEM', 'Press SPACE')} now to use it.`
            : '👉 Steer into one of the glowing crystals ahead.',
        update: () => this.itemUsed,
      },
      {
        title: 'Meet Ethan, under you',
        info: true,
        text: () =>
          'The purple kart under the floor is Ethan, upside down on the other face. ' +
          "The strip has one side, so he's on the same patch of track as you, back to back.",
        todo: () => `👉 Look down through the floor to find Ethan, then ${next()}.`,
        enter: () => this.showPartner(),
      },
      {
        title: 'Thump',
        text: () =>
          'When a kart is right under you, a pink ring locks on. A thump slams the track and launches them into the air.',
        todo: () => `👉 ${cap(thumpHow())} now to thump Ethan!`,
        enter: () => {
          this.eventDone = false;
          player.thumpCooldown = 0;
        },
        event: (k, e) => {
          if (k === partner && e === 'launched') this.eventDone = true;
        },
        update: () => {
          // Missed? No need to wait out the full cooldown while learning.
          player.thumpCooldown = Math.min(player.thumpCooldown, 1);
          return this.eventDone;
        },
      },
      {
        title: 'Bounce back',
        text: () =>
          "Now Ethan will thump you. Thump right as his bump hits and you'll bounce for big air and a turbo.",
        todo: () =>
          partner.thumping
            ? `👉 ${thumpHow().toUpperCase()} NOW!`
            : this.missed
              ? '👉 Missed. He will try again. Thump right as the bump hits!'
              : '👉 Get ready: when you see ⚠, thump!',
        enter: () => {
          this.eventDone = false;
          this.missed = false;
          this.partnerMayThump = true;
          this.thumpTimer = 2.5;
          this.waitingThump = 0;
        },
        event: (k, e) => {
          if (k !== player) return;
          if (e === 'bigAir') this.eventDone = true;
          if (e === 'thumped') {
            this.missed = true;
            this.thumpTimer = 2;
            this.waitingThump = 0;
          }
        },
        update: (dt) => {
          if (this.thumpTimer > 0) {
            this.thumpTimer -= dt;
            if (this.thumpTimer <= 0) {
              partner.thumpCooldown = 0;
              if (partner.tryThump()) this.waitingThump = 3;
              else this.thumpTimer = 0.3;
            }
          } else if (this.waitingThump > 0) {
            // Nothing happened (you drifted out of range?): go again.
            this.waitingThump -= dt;
            if (this.waitingThump <= 0 && !this.eventDone) this.thumpTimer = 0.5;
          }
          return this.eventDone;
        },
      },
      {
        title: "You're ready!",
        info: true,
        final: true,
        text: () =>
          'Races are 3 laps against 7 racers. Two grids start back to back, so there is always someone under you, ' +
          "and staying mirrored with them gives you both a slipstream boost. Watch out for Ethan: he's the fastest, and he hunts.",
        todo: () => `👉 ${ctrl('Tap RACE!', 'Tap RACE!', 'Press Enter')} when you're ready.`,
      },
    ];

    this.on(this.nextBtn, 'click', () => this.next());
    this.on(this.skipBtn, 'click', () => this.next());
    this.on(this.raceBtn, 'click', () => host.exit('race'));
    this.on(this.menuBtn, 'click', () => host.exit('title'));
    this.on($('tut-exit'), 'click', () => host.exit('title'));
    this.on(window, 'keydown', (e) => {
      if ((e as KeyboardEvent).code === 'Enter' && this.current.info) {
        if (this.current.final) host.exit('race');
        else this.next();
      }
    });

    this.card.classList.remove('hidden');
    this.enter();
  }

  private get current(): Step {
    return this.steps[this.index];
  }

  private on(el: HTMLElement | Window, type: string, fn: EventListener) {
    el.addEventListener(type, fn);
    this.listeners.push([el, type, fn]);
  }

  dispose() {
    for (const [el, type, fn] of this.listeners) el.removeEventListener(type, fn);
    this.card.classList.add('hidden');
    this.host.setPartnerActive(false);
  }

  private showPartner() {
    if (this.partnerOn) return;
    this.partnerOn = true;
    this.host.setPartnerActive(true);
  }

  private enter() {
    const step = this.current;
    this.celebrating = 0;
    this.done = false;
    this.partnerMayThump = false;
    step.enter?.();
    this.stepEl.textContent = `${this.index + 1} / ${this.steps.length}`;
    this.titleEl.textContent = step.title;
    this.textEl.textContent = step.text();
    this.todoEl.textContent = step.todo();
    this.card.classList.remove('done');
    this.nextBtn.style.display = step.info && !step.final ? '' : 'none';
    this.skipBtn.style.display = step.info ? 'none' : '';
    this.raceBtn.style.display = step.final ? '' : 'none';
    this.menuBtn.style.display = step.final ? '' : 'none';
  }

  private next() {
    if (this.index < this.steps.length - 1) {
      this.index++;
      this.enter();
    }
  }

  /** Runs inside each physics substep, before karts move. */
  beforeStep() {
    const { player, partner, trackLength } = this.host;
    if (!this.partnerOn) return;
    partner.autoTrampolineUntil = -1;
    if (partner.airborne || partner.spin > 0) return;
    if (!this.partnerMayThump) partner.thumpCooldown = 99;
    // Stay on the mirror point of the player, matching speed.
    partner.progress = player.progress + trackLength / 2;
    partner.v = -player.v;
    partner.psi = 0;
    partner.speed = player.speed;
  }

  onEvent(k: Kart, e: KartEvent) {
    if (!this.done) this.current.event?.(k, e);
  }

  onItemUsed(k: Kart) {
    if (k === this.host.player) this.itemUsed = true;
  }

  update(dt: number) {
    if (this.done) {
      this.celebrating -= dt;
      if (this.celebrating <= 0) this.next();
      return;
    }
    // Wording depends on progress within the step and on the input mode (tilt may kick in late).
    const step = this.current;
    const text = step.text();
    if (this.textEl.textContent !== text) this.textEl.textContent = text;
    const todo = step.todo();
    if (this.todoEl.textContent !== todo) this.todoEl.textContent = todo;

    if (step.update?.(dt)) {
      this.done = true;
      this.celebrating = CELEBRATE_SECONDS;
      this.card.classList.add('done');
      this.titleEl.textContent = `✓ ${step.title}`;
      this.todoEl.textContent = '✓ Nice!';
      this.host.celebrate();
    }
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
