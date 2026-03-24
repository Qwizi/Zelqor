/**
 * particleSystem.ts
 *
 * Custom behavior-based particle system for PixiJS 8.
 * Designed for real-time strategy game weather effects and combat VFX.
 * Uses Sprite-based particles with object pooling for 60fps performance.
 */

import { type Container, Sprite, Texture } from "pixi.js";

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

export type SpawnShapeConfig =
  | { type: "rect"; x: number; y: number; w: number; h: number }
  | { type: "circle"; x: number; y: number; r: number }
  | { type: "point" };

export type ParticleBehavior =
  | { type: "alpha"; config: { start: number; end: number; mid?: number } }
  | {
      type: "scale";
      config: { start: number; end: number; minimumScaleMultiplier?: number };
    }
  | { type: "color"; config: { start: string; end: string } }
  | { type: "moveSpeed"; config: { start: number; end: number } }
  | { type: "moveDirection"; config: { minAngle: number; maxAngle: number } }
  | {
      type: "rotation";
      config: {
        minStart: number;
        maxStart: number;
        minSpeed: number;
        maxSpeed: number;
      };
    }
  | { type: "acceleration"; config: { x: number; y: number } }
  | { type: "spawnShape"; config: SpawnShapeConfig }
  | { type: "textureSingle"; config: { texture: Texture } }
  | { type: "textureRandom"; config: { textures: Texture[] } };

export interface EmitterConfig {
  lifetime: { min: number; max: number };
  frequency: number;
  particlesPerWave: number;
  maxParticles: number;
  /** -1 = infinite */
  emitterLifetime: number;
  pos: { x: number; y: number };
  addAtBack: boolean;
  behaviors: ParticleBehavior[];
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

export function hexStringToNumber(hex: string): number {
  return parseInt(hex.replace(/^#/, ""), 16);
}

export function lerpColor(start: number, end: number, t: number): number {
  const sr = (start >> 16) & 0xff;
  const sg = (start >> 8) & 0xff;
  const sb = start & 0xff;
  const er = (end >> 16) & 0xff;
  const eg = (end >> 8) & 0xff;
  const eb = end & 0xff;
  const r = Math.round(sr + (er - sr) * t);
  const g = Math.round(sg + (eg - sg) * t);
  const b = Math.round(sb + (eb - sb) * t);
  return (r << 16) | (g << 8) | b;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ---------------------------------------------------------------------------
// Particle
// ---------------------------------------------------------------------------

export class Particle {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  ax = 0;
  ay = 0;
  life = 0;
  maxLife = 1;
  alpha = 1;
  startAlpha = 1;
  endAlpha = 0;
  /** Optional mid alpha for fog-like fade-in-out */
  midAlpha: number | undefined = undefined;
  scale = 1;
  startScale = 1;
  endScale = 1;
  rotation = 0;
  rotationSpeed = 0;
  tint = 0xffffff;
  startTint = 0xffffff;
  endTint = 0xffffff;
  /** Whether this particle interpolates tint */
  useColorLerp = false;
  /** Base speed at spawn — used for moveSpeed lerp */
  baseSpeed = 0;
  endSpeed = 0;
  active = false;
  sprite!: Sprite;

  reset(): void {
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.ax = 0;
    this.ay = 0;
    this.life = 0;
    this.maxLife = 1;
    this.alpha = 1;
    this.startAlpha = 1;
    this.endAlpha = 0;
    this.midAlpha = undefined;
    this.scale = 1;
    this.startScale = 1;
    this.endScale = 1;
    this.rotation = 0;
    this.rotationSpeed = 0;
    this.tint = 0xffffff;
    this.startTint = 0xffffff;
    this.endTint = 0xffffff;
    this.useColorLerp = false;
    this.baseSpeed = 0;
    this.endSpeed = 0;
    this.active = false;
  }
}

// ---------------------------------------------------------------------------
// ParticlePool
// ---------------------------------------------------------------------------

export class ParticlePool {
  private pool: Particle[] = [];
  private container: Container;
  private defaultTexture: Texture;

  constructor(container: Container, initialSize = 100, texture?: Texture) {
    this.container = container;
    this.defaultTexture = texture ?? Texture.WHITE;
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.createParticle());
    }
  }

  private createParticle(): Particle {
    const p = new Particle();
    const sprite = new Sprite(this.defaultTexture);
    sprite.anchor.set(0.5);
    sprite.visible = false;
    sprite.alpha = 0;
    this.container.addChild(sprite);
    p.sprite = sprite;
    return p;
  }

  acquire(): Particle {
    for (const p of this.pool) {
      if (!p.active) {
        p.active = true;
        p.sprite.visible = true;
        return p;
      }
    }
    // Grow pool
    const p = this.createParticle();
    this.pool.push(p);
    p.active = true;
    p.sprite.visible = true;
    return p;
  }

  release(p: Particle): void {
    p.active = false;
    p.sprite.visible = false;
    p.sprite.alpha = 0;
    p.reset();
  }

  updateDefaultTexture(texture: Texture): void {
    this.defaultTexture = texture;
  }

  cleanup(): void {
    for (const p of this.pool) {
      if (p.sprite.parent) {
        p.sprite.parent.removeChild(p.sprite);
      }
      p.sprite.destroy();
    }
    this.pool = [];
  }

  get activeCount(): number {
    return this.pool.filter((p) => p.active).length;
  }

  get totalCount(): number {
    return this.pool.length;
  }
}

// ---------------------------------------------------------------------------
// Behavior helpers applied at spawn time
// ---------------------------------------------------------------------------

function applySpawnBehaviors(particle: Particle, config: EmitterConfig, emitterX: number, emitterY: number): void {
  // Defaults
  particle.maxLife = rand(config.lifetime.min, config.lifetime.max);
  particle.life = particle.maxLife;

  let spawnX = emitterX;
  let spawnY = emitterY;
  let speed = 100;
  let endSpeed = 100;
  let angleRad = 0;
  let texture: Texture | null = null;

  for (const behavior of config.behaviors) {
    switch (behavior.type) {
      case "spawnShape": {
        const sc = behavior.config;
        if (sc.type === "point") {
          spawnX = emitterX;
          spawnY = emitterY;
        } else if (sc.type === "rect") {
          spawnX = emitterX + sc.x + Math.random() * sc.w;
          spawnY = emitterY + sc.y + Math.random() * sc.h;
        } else if (sc.type === "circle") {
          const r = Math.random() * sc.r;
          const a = Math.random() * Math.PI * 2;
          spawnX = emitterX + sc.x + Math.cos(a) * r;
          spawnY = emitterY + sc.y + Math.sin(a) * r;
        }
        break;
      }
      case "textureSingle": {
        texture = behavior.config.texture;
        break;
      }
      case "textureRandom": {
        const textures = behavior.config.textures;
        texture = textures[Math.floor(Math.random() * textures.length)];
        break;
      }
      case "moveSpeed": {
        speed = rand(behavior.config.start, behavior.config.end);
        endSpeed = behavior.config.end;
        break;
      }
      case "moveDirection": {
        angleRad = degToRad(rand(behavior.config.minAngle, behavior.config.maxAngle));
        break;
      }
      case "alpha": {
        particle.startAlpha = behavior.config.start;
        particle.endAlpha = behavior.config.end;
        particle.midAlpha = behavior.config.mid;
        particle.alpha = behavior.config.start;
        break;
      }
      case "scale": {
        particle.startScale = behavior.config.start;
        particle.endScale = behavior.config.end;
        particle.scale = behavior.config.start;
        break;
      }
      case "color": {
        particle.startTint = hexStringToNumber(behavior.config.start);
        particle.endTint = hexStringToNumber(behavior.config.end);
        particle.tint = particle.startTint;
        particle.useColorLerp = true;
        break;
      }
      case "rotation": {
        const c = behavior.config;
        particle.rotation = degToRad(rand(c.minStart, c.maxStart));
        particle.rotationSpeed = degToRad(rand(c.minSpeed, c.maxSpeed));
        break;
      }
      case "acceleration": {
        particle.ax = behavior.config.x;
        particle.ay = behavior.config.y;
        break;
      }
    }
  }

  particle.x = spawnX;
  particle.y = spawnY;
  particle.vx = Math.cos(angleRad) * speed;
  particle.vy = Math.sin(angleRad) * speed;
  particle.baseSpeed = speed;
  particle.endSpeed = endSpeed;

  if (texture) {
    particle.sprite.texture = texture;
  }
}

// ---------------------------------------------------------------------------
// ParticleEmitter
// ---------------------------------------------------------------------------

export class ParticleEmitter {
  emit = true;
  spawnPos: { x: number; y: number };
  private config: EmitterConfig;
  private pool: ParticlePool;
  private spawnTimer = 0;
  private emitterAge = 0;
  private particles: Particle[] = [];

  readonly maxParticles: number;
  readonly frequency: number;
  readonly particlesPerWave: number;
  readonly emitterLifetime: number;

  constructor(container: Container, config: EmitterConfig) {
    this.container = container;
    this.config = config;
    this.maxParticles = config.maxParticles;
    this.frequency = config.frequency;
    this.particlesPerWave = config.particlesPerWave;
    this.emitterLifetime = config.emitterLifetime;
    this.spawnPos = { x: config.pos.x, y: config.pos.y };

    this.pool = new ParticlePool(container, Math.min(config.maxParticles, 50));
  }

  resetPositionTo(x: number, y: number): void {
    this.spawnPos.x = x;
    this.spawnPos.y = y;
  }

  update(dt: number): void {
    // Tick emitter lifetime
    if (this.emitterLifetime >= 0) {
      this.emitterAge += dt;
      if (this.emitterAge >= this.emitterLifetime) {
        this.emit = false;
      }
    }

    // Spawn new particles
    if (this.emit) {
      this.spawnTimer += dt;
      while (this.spawnTimer >= this.frequency) {
        this.spawnTimer -= this.frequency;
        const currentActive = this.pool.activeCount;
        const toSpawn = Math.min(this.particlesPerWave, this.maxParticles - currentActive);
        for (let i = 0; i < toSpawn; i++) {
          this.spawnParticle();
        }
      }
    }

    // Update all active particles
    for (const p of this.particles) {
      if (!p.active) continue;

      p.life -= dt;
      if (p.life <= 0) {
        this.pool.release(p);
        continue;
      }

      const t = 1 - p.life / p.maxLife; // 0 at birth, 1 at death

      // Velocity
      p.vx += p.ax * dt;
      p.vy += p.ay * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Alpha
      if (p.midAlpha !== undefined) {
        // Fog-style: fade in first half, fade out second half
        if (t < 0.5) {
          p.alpha = lerp(p.startAlpha, p.midAlpha, t * 2);
        } else {
          p.alpha = lerp(p.midAlpha, p.endAlpha, (t - 0.5) * 2);
        }
      } else {
        p.alpha = lerp(p.startAlpha, p.endAlpha, t);
      }

      // Scale
      p.scale = lerp(p.startScale, p.endScale, t);

      // Color
      if (p.useColorLerp) {
        p.tint = lerpColor(p.startTint, p.endTint, t);
      }

      // Rotation
      p.rotation += p.rotationSpeed * dt;

      // Apply to sprite
      const sprite = p.sprite;
      sprite.x = p.x;
      sprite.y = p.y;
      sprite.alpha = Math.max(0, Math.min(1, p.alpha));
      sprite.scale.set(p.scale);
      sprite.rotation = p.rotation;
      sprite.tint = p.tint;
    }
  }

  private spawnParticle(): void {
    const p = this.pool.acquire();
    p.reset();
    p.active = true;
    applySpawnBehaviors(p, this.config, this.spawnPos.x, this.spawnPos.y);
    if (!this.particles.includes(p)) {
      this.particles.push(p);
    }
  }

  cleanup(): void {
    this.emit = false;
    for (const p of this.particles) {
      if (p.active) {
        this.pool.release(p);
      }
    }
    this.particles = [];
    this.pool.cleanup();
  }

  get isComplete(): boolean {
    return !this.emit && this.emitterLifetime >= 0 && this.pool.activeCount === 0;
  }
}

// ---------------------------------------------------------------------------
// ParticleManager
// ---------------------------------------------------------------------------

export class ParticleManager {
  private emitters = new Map<string, ParticleEmitter>();

  addEmitter(id: string, emitter: ParticleEmitter): void {
    if (this.emitters.has(id)) {
      this.emitters.get(id)?.cleanup();
    }
    this.emitters.set(id, emitter);
  }

  getEmitter(id: string): ParticleEmitter | undefined {
    return this.emitters.get(id);
  }

  removeEmitter(id: string): void {
    const emitter = this.emitters.get(id);
    if (emitter) {
      emitter.cleanup();
      this.emitters.delete(id);
    }
  }

  update(dt: number): void {
    const toRemove: string[] = [];
    for (const [id, emitter] of this.emitters) {
      emitter.update(dt);
      if (emitter.isComplete) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.emitters.get(id)?.cleanup();
      this.emitters.delete(id);
    }
  }

  cleanup(): void {
    for (const emitter of this.emitters.values()) {
      emitter.cleanup();
    }
    this.emitters.clear();
  }

  has(id: string): boolean {
    return this.emitters.has(id);
  }
}

// ---------------------------------------------------------------------------
// Procedural texture generation using OffscreenCanvas
// ---------------------------------------------------------------------------

function makeCanvas(size: number): OffscreenCanvas {
  return new OffscreenCanvas(size, size);
}

function canvasToTexture(canvas: OffscreenCanvas): Texture {
  // PixiJS 8: create texture from canvas source
  return Texture.from(canvas as unknown as HTMLCanvasElement);
}

// Cache so we never regenerate the same texture twice
const textureCache = new Map<string, Texture>();

function cached(key: string, factory: () => Texture): Texture {
  if (!textureCache.has(key)) {
    textureCache.set(key, factory());
  }
  return textureCache.get(key)!;
}

export const ParticleTextures = {
  /**
   * Soft white circle with radial gradient falloff — general-purpose.
   */
  createCircleSoft(size = 32): Texture {
    return cached(`circleSoft-${size}`, () => {
      const canvas = makeCanvas(size);
      const ctx = canvas.getContext("2d")!;
      const c = size / 2;
      const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.4, "rgba(255,255,255,0.8)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c, c, c, 0, Math.PI * 2);
      ctx.fill();
      return canvasToTexture(canvas);
    });
  },

  /**
   * Elongated raindrop shape — tall, narrow, semi-transparent.
   */
  createRaindrop(size = 32): Texture {
    return cached(`raindrop-${size}`, () => {
      const canvas = makeCanvas(size);
      const ctx = canvas.getContext("2d")!;
      const w = size * 0.2;
      const h = size * 0.85;
      const cx = size / 2;
      const cy = size / 2;
      const grad = ctx.createLinearGradient(cx, cy - h / 2, cx, cy + h / 2);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(0.2, "rgba(255,255,255,0.9)");
      grad.addColorStop(1, "rgba(255,255,255,0.5)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      return canvasToTexture(canvas);
    });
  },

  /**
   * 6-point snowflake built from crossing lines.
   */
  createSnowflake(size = 32): Texture {
    return cached(`snowflake-${size}`, () => {
      const canvas = makeCanvas(size);
      const ctx = canvas.getContext("2d")!;
      const c = size / 2;
      const r = size * 0.45;
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = size * 0.07;
      ctx.lineCap = "round";
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
        ctx.stroke();
        // Small branches
        const bx = c + Math.cos(a) * r * 0.5;
        const by = c + Math.sin(a) * r * 0.5;
        const br = r * 0.25;
        for (const ba of [a + Math.PI / 3, a - Math.PI / 3]) {
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(ba) * br, by + Math.sin(ba) * br);
          ctx.stroke();
        }
      }
      // Center dot
      const grad = ctx.createRadialGradient(c, c, 0, c, c, size * 0.1);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c, c, size * 0.12, 0, Math.PI * 2);
      ctx.fill();
      return canvasToTexture(canvas);
    });
  },

  /**
   * Small bright spark with inner white core and outer glow.
   */
  createSpark(size = 32): Texture {
    return cached(`spark-${size}`, () => {
      const canvas = makeCanvas(size);
      const ctx = canvas.getContext("2d")!;
      const c = size / 2;
      // Outer glow
      const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
      glow.addColorStop(0, "rgba(255,255,255,1)");
      glow.addColorStop(0.15, "rgba(255,220,100,0.9)");
      glow.addColorStop(0.5, "rgba(255,150,50,0.4)");
      glow.addColorStop(1, "rgba(255,100,0,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(c, c, c, 0, Math.PI * 2);
      ctx.fill();
      // Bright center
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.beginPath();
      ctx.arc(c, c, size * 0.12, 0, Math.PI * 2);
      ctx.fill();
      return canvasToTexture(canvas);
    });
  },

  /**
   * Blurry smoke puff — large soft circle with layered gradients.
   */
  createSmoke(size = 64): Texture {
    return cached(`smoke-${size}`, () => {
      const canvas = makeCanvas(size);
      const ctx = canvas.getContext("2d")!;
      const c = size / 2;
      const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
      grad.addColorStop(0, "rgba(200,200,200,0.5)");
      grad.addColorStop(0.3, "rgba(180,180,180,0.35)");
      grad.addColorStop(0.65, "rgba(160,160,160,0.2)");
      grad.addColorStop(1, "rgba(140,140,140,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c, c, c, 0, Math.PI * 2);
      ctx.fill();
      return canvasToTexture(canvas);
    });
  },

  /**
   * Small leaf shape for wind effects.
   */
  createLeaf(size = 24): Texture {
    return cached(`leaf-${size}`, () => {
      const canvas = makeCanvas(size);
      const ctx = canvas.getContext("2d")!;
      const c = size / 2;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.moveTo(c, size * 0.05);
      ctx.bezierCurveTo(size * 0.85, size * 0.1, size * 0.9, size * 0.85, c, size * 0.95);
      ctx.bezierCurveTo(size * 0.1, size * 0.85, size * 0.15, size * 0.1, c, size * 0.05);
      ctx.closePath();
      ctx.fill();
      // Vein
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = size * 0.04;
      ctx.beginPath();
      ctx.moveTo(c, size * 0.1);
      ctx.lineTo(c, size * 0.9);
      ctx.stroke();
      return canvasToTexture(canvas);
    });
  },

  /**
   * Tiny dust mote — very small soft circle.
   */
  createDust(size = 16): Texture {
    return cached(`dust-${size}`, () => {
      const canvas = makeCanvas(size);
      const ctx = canvas.getContext("2d")!;
      const c = size / 2;
      const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
      grad.addColorStop(0, "rgba(255,245,220,1)");
      grad.addColorStop(0.5, "rgba(255,240,200,0.6)");
      grad.addColorStop(1, "rgba(255,235,180,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c, c, c, 0, Math.PI * 2);
      ctx.fill();
      return canvasToTexture(canvas);
    });
  },

  /**
   * Bright center with large soft glow — for fireflies / ambient lights.
   */
  createFirefly(size = 32): Texture {
    return cached(`firefly-${size}`, () => {
      const canvas = makeCanvas(size);
      const ctx = canvas.getContext("2d")!;
      const c = size / 2;
      // Outer soft halo
      const halo = ctx.createRadialGradient(c, c, 0, c, c, c);
      halo.addColorStop(0, "rgba(255,255,200,0.9)");
      halo.addColorStop(0.25, "rgba(255,255,150,0.6)");
      halo.addColorStop(0.6, "rgba(255,240,100,0.2)");
      halo.addColorStop(1, "rgba(255,220,50,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(c, c, c, 0, Math.PI * 2);
      ctx.fill();
      // Bright white core
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.beginPath();
      ctx.arc(c, c, size * 0.1, 0, Math.PI * 2);
      ctx.fill();
      return canvasToTexture(canvas);
    });
  },

  /**
   * Small lightning bolt fragment — jagged white line.
   */
  createLightning(size = 32): Texture {
    return cached(`lightning-${size}`, () => {
      const canvas = makeCanvas(size);
      const ctx = canvas.getContext("2d")!;
      // Glow pass
      ctx.shadowColor = "rgba(150,150,255,0.8)";
      ctx.shadowBlur = size * 0.3;
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = size * 0.08;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const pts = [
        [size * 0.55, size * 0.05],
        [size * 0.35, size * 0.45],
        [size * 0.55, size * 0.45],
        [size * 0.3, size * 0.95],
      ];
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.stroke();
      return canvasToTexture(canvas);
    });
  },

  /**
   * 4-point star sparkle — sharp cross with diagonal fade.
   */
  createStar(size = 32): Texture {
    return cached(`star-${size}`, () => {
      const canvas = makeCanvas(size);
      const ctx = canvas.getContext("2d")!;
      const c = size / 2;
      ctx.save();
      ctx.translate(c, c);
      // Draw 4 arms at 0, 90, 45, 135 degrees
      for (let a = 0; a < 4; a++) {
        ctx.save();
        ctx.rotate((a * Math.PI) / 4);
        const grad = ctx.createLinearGradient(0, -c, 0, c);
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(0.4, "rgba(255,255,255,0.9)");
        grad.addColorStop(0.5, "rgba(255,255,255,1)");
        grad.addColorStop(0.6, "rgba(255,255,255,0.9)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        const w = a < 2 ? size * 0.08 : size * 0.04;
        ctx.fillStyle = grad;
        ctx.fillRect(-w / 2, -c, w, size);
        ctx.restore();
      }
      ctx.restore();
      // Center bright dot
      const dot = ctx.createRadialGradient(c, c, 0, c, c, size * 0.15);
      dot.addColorStop(0, "rgba(255,255,255,1)");
      dot.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = dot;
      ctx.beginPath();
      ctx.arc(c, c, size * 0.2, 0, Math.PI * 2);
      ctx.fill();
      return canvasToTexture(canvas);
    });
  },
};

// ---------------------------------------------------------------------------
// Viewport helper type
// ---------------------------------------------------------------------------

export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Pre-built Effect Presets
// ---------------------------------------------------------------------------

export const ParticlePresets = {
  // ---- Weather ----

  rain(viewport: Viewport): EmitterConfig {
    return {
      lifetime: { min: 0.8, max: 1.5 },
      frequency: 0.005,
      particlesPerWave: 3,
      maxParticles: 200,
      emitterLifetime: -1,
      pos: { x: 0, y: 0 },
      addAtBack: true,
      behaviors: [
        {
          type: "spawnShape",
          config: { type: "rect", x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
        },
        {
          type: "textureSingle",
          config: { texture: ParticleTextures.createRaindrop() },
        },
        { type: "alpha", config: { start: 0.3, end: 0.0 } },
        { type: "scale", config: { start: 0.3, end: 0.5 } },
        { type: "moveSpeed", config: { start: 800, end: 1200 } },
        { type: "moveDirection", config: { minAngle: 75, maxAngle: 85 } },
        { type: "color", config: { start: "#a8c4d8", end: "#a8c4d8" } },
      ],
    };
  },

  heavyRain(viewport: Viewport): EmitterConfig {
    return {
      lifetime: { min: 0.6, max: 1.2 },
      frequency: 0.003,
      particlesPerWave: 5,
      maxParticles: 350,
      emitterLifetime: -1,
      pos: { x: 0, y: 0 },
      addAtBack: true,
      behaviors: [
        {
          type: "spawnShape",
          config: { type: "rect", x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
        },
        {
          type: "textureSingle",
          config: { texture: ParticleTextures.createRaindrop() },
        },
        { type: "alpha", config: { start: 0.4, end: 0.0 } },
        { type: "scale", config: { start: 0.4, end: 0.6 } },
        { type: "moveSpeed", config: { start: 900, end: 1400 } },
        { type: "moveDirection", config: { minAngle: 78, maxAngle: 88 } },
        { type: "color", config: { start: "#99b8cc", end: "#99b8cc" } },
      ],
    };
  },

  storm(viewport: Viewport): EmitterConfig {
    return {
      lifetime: { min: 0.6, max: 1.2 },
      frequency: 0.003,
      particlesPerWave: 5,
      maxParticles: 400,
      emitterLifetime: -1,
      pos: { x: 0, y: 0 },
      addAtBack: true,
      behaviors: [
        {
          type: "spawnShape",
          config: { type: "rect", x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
        },
        {
          type: "textureSingle",
          config: { texture: ParticleTextures.createRaindrop() },
        },
        { type: "alpha", config: { start: 0.4, end: 0.0 } },
        { type: "scale", config: { start: 0.4, end: 0.7 } },
        { type: "moveSpeed", config: { start: 1000, end: 1600 } },
        { type: "moveDirection", config: { minAngle: 60, maxAngle: 75 } },
        { type: "color", config: { start: "#8899aa", end: "#8899aa" } },
      ],
    };
  },

  snow(viewport: Viewport): EmitterConfig {
    return {
      lifetime: { min: 4, max: 8 },
      frequency: 0.03,
      particlesPerWave: 2,
      maxParticles: 150,
      emitterLifetime: -1,
      pos: { x: 0, y: 0 },
      addAtBack: false,
      behaviors: [
        {
          type: "spawnShape",
          config: {
            type: "rect",
            x: viewport.x,
            y: viewport.y,
            w: viewport.w,
            h: viewport.h * 0.1,
          },
        },
        {
          type: "textureSingle",
          config: { texture: ParticleTextures.createSnowflake() },
        },
        { type: "alpha", config: { start: 0.6, end: 0.0 } },
        { type: "scale", config: { start: 0.2, end: 0.4 } },
        { type: "moveSpeed", config: { start: 30, end: 80 } },
        { type: "moveDirection", config: { minAngle: 80, maxAngle: 100 } },
        {
          type: "rotation",
          config: { minStart: 0, maxStart: 360, minSpeed: -60, maxSpeed: 60 },
        },
        { type: "color", config: { start: "#ffffff", end: "#ddeeff" } },
      ],
    };
  },

  fog(viewport: Viewport): EmitterConfig {
    return {
      lifetime: { min: 6, max: 12 },
      frequency: 0.2,
      particlesPerWave: 1,
      maxParticles: 30,
      emitterLifetime: -1,
      pos: { x: 0, y: 0 },
      addAtBack: true,
      behaviors: [
        {
          type: "spawnShape",
          config: { type: "rect", x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
        },
        {
          type: "textureSingle",
          config: { texture: ParticleTextures.createSmoke() },
        },
        { type: "alpha", config: { start: 0.0, end: 0.0, mid: 0.15 } },
        { type: "scale", config: { start: 2.0, end: 4.0 } },
        { type: "moveSpeed", config: { start: 5, end: 20 } },
        { type: "moveDirection", config: { minAngle: 170, maxAngle: 190 } },
        { type: "color", config: { start: "#d0d0d0", end: "#c0c0c0" } },
      ],
    };
  },

  fireflies(viewport: Viewport): EmitterConfig {
    return {
      lifetime: { min: 3, max: 6 },
      frequency: 0.15,
      particlesPerWave: 1,
      maxParticles: 40,
      emitterLifetime: -1,
      pos: { x: 0, y: 0 },
      addAtBack: false,
      behaviors: [
        {
          type: "spawnShape",
          config: { type: "rect", x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
        },
        {
          type: "textureSingle",
          config: { texture: ParticleTextures.createFirefly() },
        },
        { type: "alpha", config: { start: 0.0, end: 0.0, mid: 0.8 } },
        { type: "scale", config: { start: 0.15, end: 0.25 } },
        { type: "moveSpeed", config: { start: 5, end: 15 } },
        { type: "moveDirection", config: { minAngle: 0, maxAngle: 360 } },
        { type: "color", config: { start: "#ffee88", end: "#aadd44" } },
      ],
    };
  },

  dust(viewport: Viewport): EmitterConfig {
    return {
      lifetime: { min: 2, max: 5 },
      frequency: 0.04,
      particlesPerWave: 2,
      maxParticles: 80,
      emitterLifetime: -1,
      pos: { x: 0, y: 0 },
      addAtBack: true,
      behaviors: [
        {
          type: "spawnShape",
          config: { type: "rect", x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
        },
        {
          type: "textureSingle",
          config: { texture: ParticleTextures.createDust() },
        },
        { type: "alpha", config: { start: 0.0, end: 0.0, mid: 0.4 } },
        { type: "scale", config: { start: 0.3, end: 0.8 } },
        { type: "moveSpeed", config: { start: 20, end: 60 } },
        { type: "moveDirection", config: { minAngle: 175, maxAngle: 185 } },
        { type: "color", config: { start: "#d4b483", end: "#c4a070" } },
      ],
    };
  },

  // ---- Combat / VFX ----

  explosion(x: number, y: number): EmitterConfig {
    return {
      lifetime: { min: 0.3, max: 0.8 },
      frequency: 0.001,
      particlesPerWave: 60,
      maxParticles: 60,
      emitterLifetime: 0.1,
      pos: { x, y },
      addAtBack: false,
      behaviors: [
        { type: "spawnShape", config: { type: "circle", x: 0, y: 0, r: 5 } },
        {
          type: "textureRandom",
          config: {
            textures: [ParticleTextures.createSpark(), ParticleTextures.createSmoke()],
          },
        },
        { type: "alpha", config: { start: 1.0, end: 0.0 } },
        { type: "scale", config: { start: 0.5, end: 0.1 } },
        { type: "moveSpeed", config: { start: 200, end: 500 } },
        { type: "moveDirection", config: { minAngle: 0, maxAngle: 360 } },
        { type: "acceleration", config: { x: 0, y: 100 } },
        { type: "color", config: { start: "#ff6600", end: "#ff2200" } },
        {
          type: "rotation",
          config: { minStart: 0, maxStart: 360, minSpeed: -180, maxSpeed: 180 },
        },
      ],
    };
  },

  smokeTrail(x: number, y: number): EmitterConfig {
    return {
      lifetime: { min: 0.8, max: 1.6 },
      frequency: 0.02,
      particlesPerWave: 2,
      maxParticles: 40,
      emitterLifetime: -1,
      pos: { x, y },
      addAtBack: true,
      behaviors: [
        { type: "spawnShape", config: { type: "circle", x: 0, y: 0, r: 3 } },
        {
          type: "textureSingle",
          config: { texture: ParticleTextures.createSmoke() },
        },
        { type: "alpha", config: { start: 0.5, end: 0.0 } },
        { type: "scale", config: { start: 0.3, end: 1.2 } },
        { type: "moveSpeed", config: { start: 20, end: 60 } },
        { type: "moveDirection", config: { minAngle: 255, maxAngle: 285 } },
        { type: "color", config: { start: "#888888", end: "#444444" } },
      ],
    };
  },

  sparks(x: number, y: number): EmitterConfig {
    return {
      lifetime: { min: 0.2, max: 0.6 },
      frequency: 0.005,
      particlesPerWave: 8,
      maxParticles: 50,
      emitterLifetime: 0.2,
      pos: { x, y },
      addAtBack: false,
      behaviors: [
        { type: "spawnShape", config: { type: "point" } },
        {
          type: "textureSingle",
          config: { texture: ParticleTextures.createSpark() },
        },
        { type: "alpha", config: { start: 1.0, end: 0.0 } },
        { type: "scale", config: { start: 0.2, end: 0.05 } },
        { type: "moveSpeed", config: { start: 100, end: 300 } },
        { type: "moveDirection", config: { minAngle: 0, maxAngle: 360 } },
        { type: "acceleration", config: { x: 0, y: 150 } },
        { type: "color", config: { start: "#ffffff", end: "#ffaa00" } },
      ],
    };
  },

  capitalGlow(x: number, y: number, color: number): EmitterConfig {
    const hex = `#${color.toString(16).padStart(6, "0")}`;
    return {
      lifetime: { min: 1.5, max: 3.0 },
      frequency: 0.1,
      particlesPerWave: 1,
      maxParticles: 20,
      emitterLifetime: -1,
      pos: { x, y },
      addAtBack: false,
      behaviors: [
        { type: "spawnShape", config: { type: "circle", x: 0, y: 0, r: 15 } },
        {
          type: "textureSingle",
          config: { texture: ParticleTextures.createStar() },
        },
        { type: "alpha", config: { start: 0.0, end: 0.0, mid: 0.5 } },
        { type: "scale", config: { start: 0.2, end: 0.4 } },
        { type: "moveSpeed", config: { start: 10, end: 30 } },
        { type: "moveDirection", config: { minAngle: 250, maxAngle: 290 } },
        { type: "color", config: { start: hex, end: "#ffffff" } },
      ],
    };
  },

  nukeMushroom(x: number, y: number): EmitterConfig {
    return {
      lifetime: { min: 2, max: 5 },
      frequency: 0.005,
      particlesPerWave: 30,
      maxParticles: 200,
      emitterLifetime: 3,
      pos: { x, y },
      addAtBack: false,
      behaviors: [
        { type: "spawnShape", config: { type: "circle", x: 0, y: 0, r: 20 } },
        {
          type: "textureSingle",
          config: { texture: ParticleTextures.createSmoke() },
        },
        { type: "alpha", config: { start: 0.8, end: 0.0 } },
        { type: "scale", config: { start: 1.0, end: 5.0 } },
        { type: "moveSpeed", config: { start: 100, end: 300 } },
        { type: "moveDirection", config: { minAngle: 85, maxAngle: 95 } },
        { type: "acceleration", config: { x: 0, y: -50 } },
        { type: "color", config: { start: "#ff6600", end: "#444444" } },
      ],
    };
  },

  shieldShimmer(x: number, y: number, color: number): EmitterConfig {
    const hex = `#${color.toString(16).padStart(6, "0")}`;
    return {
      lifetime: { min: 0.5, max: 1.5 },
      frequency: 0.05,
      particlesPerWave: 2,
      maxParticles: 30,
      emitterLifetime: -1,
      pos: { x, y },
      addAtBack: false,
      behaviors: [
        { type: "spawnShape", config: { type: "circle", x: 0, y: 0, r: 25 } },
        {
          type: "textureSingle",
          config: { texture: ParticleTextures.createStar() },
        },
        { type: "alpha", config: { start: 0.6, end: 0.0 } },
        { type: "scale", config: { start: 0.1, end: 0.3 } },
        { type: "moveSpeed", config: { start: 20, end: 40 } },
        { type: "moveDirection", config: { minAngle: 0, maxAngle: 360 } },
        { type: "color", config: { start: hex, end: "#ffffff" } },
      ],
    };
  },

  // ---- Artillery cinematic effects ----

  /** Muzzle flash + smoke burst at the artillery source position when rockets launch. */
  artilleryMuzzle(x: number, y: number): EmitterConfig {
    return {
      lifetime: { min: 0.3, max: 0.7 },
      frequency: 0.001,
      particlesPerWave: 25,
      maxParticles: 25,
      emitterLifetime: 0.05,
      pos: { x, y },
      addAtBack: false,
      behaviors: [
        { type: "spawnShape", config: { type: "circle", x: 0, y: 0, r: 8 } },
        {
          type: "textureRandom",
          config: {
            textures: [ParticleTextures.createSmoke(), ParticleTextures.createCircleSoft()],
          },
        },
        { type: "alpha", config: { start: 0.8, end: 0.0 } },
        { type: "scale", config: { start: 0.4, end: 1.5 } },
        { type: "moveSpeed", config: { start: 40, end: 120 } },
        { type: "moveDirection", config: { minAngle: 0, maxAngle: 360 } },
        { type: "color", config: { start: "#ffcc44", end: "#666666" } },
      ],
    };
  },

  /** Big cinematic impact — fireball + shockwave ring + debris + rising smoke column. */
  artilleryImpact(x: number, y: number): EmitterConfig {
    return {
      lifetime: { min: 0.5, max: 1.5 },
      frequency: 0.001,
      particlesPerWave: 40,
      maxParticles: 40,
      emitterLifetime: 0.05,
      pos: { x, y },
      addAtBack: false,
      behaviors: [
        { type: "spawnShape", config: { type: "circle", x: 0, y: 0, r: 10 } },
        {
          type: "textureRandom",
          config: {
            textures: [
              ParticleTextures.createSpark(),
              ParticleTextures.createSmoke(),
              ParticleTextures.createCircleSoft(),
            ],
          },
        },
        { type: "alpha", config: { start: 1.0, end: 0.0 } },
        { type: "scale", config: { start: 0.6, end: 0.15 } },
        { type: "moveSpeed", config: { start: 150, end: 400 } },
        { type: "moveDirection", config: { minAngle: 0, maxAngle: 360 } },
        { type: "acceleration", config: { x: 0, y: 80 } },
        { type: "color", config: { start: "#ffaa00", end: "#ff2200" } },
        {
          type: "rotation",
          config: { minStart: 0, maxStart: 360, minSpeed: -120, maxSpeed: 120 },
        },
      ],
    };
  },

  /** Rising smoke column after artillery impact — dark billowing smoke. */
  artillerySmoke(x: number, y: number): EmitterConfig {
    return {
      lifetime: { min: 1.5, max: 3.0 },
      frequency: 0.03,
      particlesPerWave: 3,
      maxParticles: 30,
      emitterLifetime: 1.5,
      pos: { x, y },
      addAtBack: true,
      behaviors: [
        { type: "spawnShape", config: { type: "circle", x: 0, y: 0, r: 6 } },
        {
          type: "textureSingle",
          config: { texture: ParticleTextures.createSmoke() },
        },
        { type: "alpha", config: { start: 0.0, end: 0.0, mid: 0.5 } },
        { type: "scale", config: { start: 0.5, end: 2.5 } },
        { type: "moveSpeed", config: { start: 15, end: 40 } },
        { type: "moveDirection", config: { minAngle: 260, maxAngle: 280 } },
        { type: "color", config: { start: "#555555", end: "#222222" } },
      ],
    };
  },

  /** Ground debris flying outward from impact point. */
  artilleryDebris(x: number, y: number): EmitterConfig {
    return {
      lifetime: { min: 0.4, max: 1.0 },
      frequency: 0.001,
      particlesPerWave: 15,
      maxParticles: 15,
      emitterLifetime: 0.05,
      pos: { x, y },
      addAtBack: false,
      behaviors: [
        { type: "spawnShape", config: { type: "circle", x: 0, y: 0, r: 4 } },
        {
          type: "textureSingle",
          config: { texture: ParticleTextures.createDust() },
        },
        { type: "alpha", config: { start: 0.9, end: 0.0 } },
        { type: "scale", config: { start: 0.15, end: 0.05 } },
        { type: "moveSpeed", config: { start: 200, end: 500 } },
        { type: "moveDirection", config: { minAngle: 0, maxAngle: 360 } },
        { type: "acceleration", config: { x: 0, y: 250 } },
        { type: "color", config: { start: "#aa8855", end: "#665533" } },
        {
          type: "rotation",
          config: { minStart: 0, maxStart: 360, minSpeed: -300, maxSpeed: 300 },
        },
      ],
    };
  },

  /** SAM intercept flash — bright white-yellow burst in mid-air. */
  samIntercept(x: number, y: number): EmitterConfig {
    return {
      lifetime: { min: 0.2, max: 0.5 },
      frequency: 0.001,
      particlesPerWave: 25,
      maxParticles: 25,
      emitterLifetime: 0.05,
      pos: { x, y },
      addAtBack: false,
      behaviors: [
        { type: "spawnShape", config: { type: "circle", x: 0, y: 0, r: 4 } },
        {
          type: "textureRandom",
          config: {
            textures: [ParticleTextures.createSpark(), ParticleTextures.createStar()],
          },
        },
        { type: "alpha", config: { start: 1.0, end: 0.0 } },
        { type: "scale", config: { start: 0.4, end: 0.05 } },
        { type: "moveSpeed", config: { start: 120, end: 300 } },
        { type: "moveDirection", config: { minAngle: 0, maxAngle: 360 } },
        { type: "color", config: { start: "#ffffff", end: "#ffcc00" } },
      ],
    };
  },
};
