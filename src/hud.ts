import { Kart, ItemKind } from './kart';
import { MobiusTrack, newFrame } from './track';

const $ = (id: string) => document.getElementById(id)!;

const ITEM_ICON: Record<ItemKind, string> = { turbo: '⚡', slick: '🫧' };

function ordinal(n: number): string {
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0];
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export class Hud {
  private readonly root = $('hud');
  private readonly pos = $('pos');
  private readonly lap = $('lap');
  private readonly time = $('time');
  private readonly item = $('item');
  private readonly side = $('side');
  private readonly msg = $('msg');
  private readonly thumpBtn = $('btn-thump');
  private readonly thumpKey = $('thump-key');
  private readonly link = $('link');
  private readonly needle = $('tilt-needle');
  private lastNeedle = '';
  private readonly map = ($('minimap') as HTMLCanvasElement).getContext('2d')!;
  private mapBase: HTMLCanvasElement | null = null;
  private mapScale = 1;
  private msgTimer = 0;
  private lastItem: ItemKind | null | undefined = undefined;
  private lastText = '';

  setVisible(on: boolean) {
    this.root.classList.toggle('hidden', !on);
  }

  update(dt: number, player: Kart, rank: number, laps: number, raceTime: number) {
    this.set(this.pos, `${rank}<sup>${ordinal(rank)}</sup>`);
    this.set(this.lap, `LAP ${Math.min(Math.max(player.lap, 1), laps)}/${laps}`);
    this.time.textContent = formatTime(raceTime);
    this.set(this.side, player.onSideB ? 'SIDE B' : 'SIDE A');
    if (player.item !== this.lastItem) {
      this.item.textContent = player.item ? ITEM_ICON[player.item] : '';
      if (player.item) {
        this.item.classList.remove('pop');
        void this.item.offsetWidth;
        this.item.classList.add('pop');
      }
      this.lastItem = player.item;
    }
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.msg.classList.remove('show');
    }
  }

  /** charge: 0..1 cooldown progress; armed: someone is mirrored below you. */
  setThump(charge: number, armed: boolean) {
    const ready = charge >= 1;
    const pct = `${Math.round(Math.min(1, charge) * 100)}%`;
    for (const el of [this.thumpBtn, this.thumpKey]) {
      el.style.setProperty('--charge', pct);
      el.classList.toggle('ready', ready);
      el.classList.toggle('armed', ready && armed);
    }
  }

  setSteer(steer: number) {
    const t = `rotate(${(steer * 45).toFixed(1)}deg)`;
    if (t !== this.lastNeedle) this.needle.style.transform = t;
    this.lastNeedle = t;
  }

  /** 0..1 strength of the antipode slipstream bonus. */
  setLink(strength: number) {
    this.link.classList.toggle('on', strength > 0);
    this.link.style.setProperty('--link', `${Math.round(strength * 100)}%`);
  }

  private set(el: HTMLElement, html: string) {
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  flash(text: string, seconds = 1.2, small = false) {
    if (text !== this.lastText || !this.msg.classList.contains('show')) this.msg.textContent = text;
    this.lastText = text;
    this.msg.classList.toggle('small', small);
    this.msg.classList.add('show');
    this.msgTimer = seconds;
  }

  /** Top-down view of the real geometry. The strip's width visibly shrinks where it's on edge. */
  drawMinimap(track: MobiusTrack, karts: Kart[], player: Kart) {
    const g = this.map;
    const W = g.canvas.width;
    if (!this.mapBase) {
      this.mapBase = document.createElement('canvas');
      this.mapBase.width = this.mapBase.height = W;
      const b = this.mapBase.getContext('2d')!;
      this.mapScale = (W / 2 - 10) / (track.radius + track.halfWidth);
      const f = newFrame();
      const steps = 200;
      b.fillStyle = 'rgba(255,255,255,0.22)';
      b.strokeStyle = 'rgba(255,255,255,0.7)';
      b.lineWidth = 2;
      for (let i = 0; i < steps; i++) {
        const quad: [number, number][] = [];
        for (const [k, v] of [[i, -1], [i + 1, -1], [i + 1, 1], [i, 1]]) {
          track.sample((k / steps) * (track.length / 2), v * track.halfWidth, 0, f);
          quad.push([W / 2 + f.pos.x * this.mapScale, W / 2 + f.pos.z * this.mapScale]);
        }
        b.beginPath();
        quad.forEach(([x, y], j) => (j ? b.lineTo(x, y) : b.moveTo(x, y)));
        b.closePath();
        b.fill();
      }
    }
    g.clearRect(0, 0, W, W);
    g.drawImage(this.mapBase, 0, 0);
    // Your grid are solid dots; the other grid (racing from the far line) are rings.
    for (const k of karts) {
      const p = k.group.position;
      const r = k === player ? 9 : 6;
      const color = `#${k.color.toString(16).padStart(6, '0')}`;
      g.beginPath();
      g.arc(W / 2 + p.x * this.mapScale, W / 2 + p.z * this.mapScale, r, 0, Math.PI * 2);
      if (k.grid === player.grid) {
        g.fillStyle = color;
        g.fill();
      } else {
        g.lineWidth = 3.5;
        g.strokeStyle = color;
        g.stroke();
      }
      if (k === player) {
        g.lineWidth = 3;
        g.strokeStyle = '#fff';
        g.stroke();
      }
    }
  }
}
