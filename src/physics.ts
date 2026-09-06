export type Point = [number, number, number];

type Edge = { a: number; b: number; length: number; lambda: number };
type Tetrahedron = { ids: [number, number, number, number]; volume: number; lambda: number };
type Grab = { origins: Float64Array; weights: Float64Array; delta: Point };

export const JELLY_SIZE: Point = [3.3, 1.85, 3.3];
export const FLOOR = 0.06;

/** A tetrahedral XPBD body: edge elasticity, volume preservation, and floor contact. */
export class JellyPhysics {
  readonly divisions = 5;
  readonly count = (this.divisions + 1) ** 3;
  readonly positions = new Float64Array(this.count * 3);
  readonly rest = new Float64Array(this.count * 3);
  readonly velocities = new Float64Array(this.count * 3);
  private readonly previous = new Float64Array(this.count * 3);
  private readonly edges: Array<Edge> = [];
  private readonly tetrahedra: Array<Tetrahedron> = [];
  private readonly gradients = new Float64Array(12);
  private grab: Grab | null = null;
  squishiness = 55;
  bounciness = 65;

  constructor() {
    const n = this.divisions;
    for (let z = 0; z <= n; z++) {
      for (let y = 0; y <= n; y++) {
        for (let x = 0; x <= n; x++) {
          const i = this.index(x, y, z) * 3;
          this.rest[i] = (x / n - 0.5) * JELLY_SIZE[0];
          this.rest[i + 1] = y / n * JELLY_SIZE[1] + FLOOR;
          this.rest[i + 2] = (z / n - 0.5) * JELLY_SIZE[2];
        }
      }
    }
    this.positions.set(this.rest);

    const edgeSet = new Set<string>();
    for (let z = 0; z < n; z++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const a = this.index(x, y, z);
          const b = this.index(x + 1, y, z);
          const c = this.index(x, y + 1, z);
          const d = this.index(x + 1, y + 1, z);
          const e = this.index(x, y, z + 1);
          const f = this.index(x + 1, y, z + 1);
          const g = this.index(x, y + 1, z + 1);
          const h = this.index(x + 1, y + 1, z + 1);
          // All cells share the same body diagonal, so neighboring faces agree.
          const cells: Array<[number, number, number, number]> = [
            [a, b, d, h], [a, d, c, h], [a, c, g, h],
            [a, g, e, h], [a, e, f, h], [a, f, b, h],
          ];
          for (const ids of cells) {
            this.tetrahedra.push({ ids, volume: this.signedVolume(ids), lambda: 0 });
            for (let i = 0; i < 4; i++) {
              for (let j = i + 1; j < 4; j++) {
                const lo = Math.min(ids[i], ids[j]);
                const hi = Math.max(ids[i], ids[j]);
                const key = `${lo}:${hi}`;
                if (edgeSet.has(key)) continue;
                edgeSet.add(key);
                const length = Math.hypot(
                  this.rest[lo * 3] - this.rest[hi * 3],
                  this.rest[lo * 3 + 1] - this.rest[hi * 3 + 1],
                  this.rest[lo * 3 + 2] - this.rest[hi * 3 + 2],
                );
                this.edges.push({ a: lo * 3, b: hi * 3, length, lambda: 0 });
              }
            }
          }
        }
      }
    }
  }

  index(x: number, y: number, z: number): number {
    const stride = this.divisions + 1;
    return z * stride * stride + y * stride + x;
  }

  reset(): void {
    this.positions.set(this.rest);
    this.previous.set(this.rest);
    this.velocities.fill(0);
    this.grab = null;
  }

  nudge(): void {
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      const height = (this.rest[k + 1] - FLOOR) / JELLY_SIZE[1];
      this.velocities[k] += (height - 0.3) * 2.1;
      this.velocities[k + 1] += 4.5 + Math.cos(this.rest[k] * 2) * 0.65;
      this.velocities[k + 2] += Math.sin(this.rest[k + 1] * 2.3) * 1.1;
    }
  }

  startGrab(point: Point): void {
    const weights = new Float64Array(this.count);
    let nearest = 0;
    let nearestDistance = Infinity;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      const distance = Math.hypot(
        this.positions[k] - point[0],
        this.positions[k + 1] - point[1],
        this.positions[k + 2] - point[2],
      );
      weights[i] = Math.exp(-distance * distance / 0.36);
      if (distance < nearestDistance) {
        nearest = i;
        nearestDistance = distance;
      }
    }
    weights[nearest] = 1;
    this.grab = { origins: this.positions.slice(), weights, delta: [0, 0, 0] };
  }

  moveGrab(delta: Point): void {
    if (!this.grab) return;
    const length = Math.hypot(...delta);
    const scale = length > 3.5 ? 3.5 / length : 1;
    this.grab.delta = [delta[0] * scale, delta[1] * scale, delta[2] * scale];
  }

  endGrab(poke = false): void {
    if (poke && this.grab) {
      for (let i = 0; i < this.count; i++) {
        this.velocities[i * 3 + 1] -= this.grab.weights[i] * 5;
        this.velocities[i * 3] += this.grab.weights[i] * 1.6;
      }
    }
    this.grab = null;
  }

  step(dt = 1 / 120): void {
    if (!(dt > 0) || dt > 1 / 30) throw new RangeError('Use a physics step between 0 and 1/30 second.');
    const p = this.positions;
    const v = this.velocities;
    this.previous.set(p);
    let avgX = 0;
    let avgY = 0;
    let avgZ = 0;
    for (let i = 0; i < this.count; i++) {
      avgX += v[i * 3];
      avgY += v[i * 3 + 1];
      avgZ += v[i * 3 + 2];
    }
    avgX /= this.count;
    avgY /= this.count;
    avgZ /= this.count;
    const damping = Math.exp(-(6 - this.bounciness * 0.053) * dt);
    const airDrag = Math.exp(-0.28 * dt);
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      v[k] = (avgX + (v[k] - avgX) * damping) * airDrag;
      v[k + 1] = (avgY + (v[k + 1] - avgY) * damping - 12.8 * dt) * airDrag;
      v[k + 2] = (avgZ + (v[k + 2] - avgZ) * damping) * airDrag;
      for (let axis = 0; axis < 3; axis++) p[k + axis] += v[k + axis] * dt;
    }

    const compliance = (0.000008 + (this.squishiness / 100) ** 2 * 0.0014) / (dt * dt);
    const volumeCompliance = 0.000000008 / (dt * dt);
    for (const edge of this.edges) edge.lambda = 0;
    for (const tetra of this.tetrahedra) tetra.lambda = 0;

    for (let iteration = 0; iteration < 7; iteration++) {
      for (const edge of this.edges) {
        const { a, b } = edge;
        const dx = p[a] - p[b];
        const dy = p[a + 1] - p[b + 1];
        const dz = p[a + 2] - p[b + 2];
        const distance = Math.hypot(dx, dy, dz);
        if (distance < 1e-8) continue;
        const delta = (-(distance - edge.length) - compliance * edge.lambda) / (2 + compliance);
        edge.lambda += delta;
        const correction = delta / distance;
        p[a] += dx * correction;
        p[a + 1] += dy * correction;
        p[a + 2] += dz * correction;
        p[b] -= dx * correction;
        p[b + 1] -= dy * correction;
        p[b + 2] -= dz * correction;
      }

      for (const tetra of this.tetrahedra) this.solveVolume(tetra, volumeCompliance);

      if (this.grab) {
        const { origins, weights, delta } = this.grab;
        for (let i = 0; i < this.count; i++) {
          const strength = weights[i] * 0.38;
          if (strength < 0.005) continue;
          for (let axis = 0; axis < 3; axis++) {
            const k = i * 3 + axis;
            p[k] += (origins[k] + delta[axis] - p[k]) * strength;
          }
        }
      }

      for (let i = 0; i < this.count; i++) {
        const k = i * 3;
        p[k] = Math.max(-4.2, Math.min(4.2, p[k]));
        p[k + 1] = Math.max(FLOOR, Math.min(6, p[k + 1]));
        p[k + 2] = Math.max(-3.4, Math.min(3.4, p[k + 2]));
      }
    }

    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      for (let axis = 0; axis < 3; axis++) {
        v[k + axis] = Math.max(-18, Math.min(18, (p[k + axis] - this.previous[k + axis]) / dt));
      }
      if (p[k + 1] <= FLOOR + 0.001) {
        v[k] *= 0.92;
        v[k + 2] *= 0.92;
        v[k + 1] = Math.max(0, v[k + 1]);
      }
    }
  }

  private signedVolume(ids: [number, number, number, number]): number {
    const p = this.positions;
    const [a, b, c, d] = ids.map(function offset(i) { return i * 3; });
    const ax = p[b] - p[a];
    const ay = p[b + 1] - p[a + 1];
    const az = p[b + 2] - p[a + 2];
    const bx = p[c] - p[a];
    const by = p[c + 1] - p[a + 1];
    const bz = p[c + 2] - p[a + 2];
    const cx = p[d] - p[a];
    const cy = p[d + 1] - p[a + 1];
    const cz = p[d + 2] - p[a + 2];
    return (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }

  private solveVolume(tetra: Tetrahedron, compliance: number): void {
    const p = this.positions;
    const a = tetra.ids[0] * 3;
    const b = tetra.ids[1] * 3;
    const c = tetra.ids[2] * 3;
    const d = tetra.ids[3] * 3;
    const ax = p[b] - p[a]; const ay = p[b + 1] - p[a + 1]; const az = p[b + 2] - p[a + 2];
    const bx = p[c] - p[a]; const by = p[c + 1] - p[a + 1]; const bz = p[c + 2] - p[a + 2];
    const cx = p[d] - p[a]; const cy = p[d + 1] - p[a + 1]; const cz = p[d + 2] - p[a + 2];
    const g = this.gradients;
    g[3] = (by * cz - bz * cy) / 6;
    g[4] = (bz * cx - bx * cz) / 6;
    g[5] = (bx * cy - by * cx) / 6;
    g[6] = (cy * az - cz * ay) / 6;
    g[7] = (cz * ax - cx * az) / 6;
    g[8] = (cx * ay - cy * ax) / 6;
    g[9] = (ay * bz - az * by) / 6;
    g[10] = (az * bx - ax * bz) / 6;
    g[11] = (ax * by - ay * bx) / 6;
    for (let axis = 0; axis < 3; axis++) g[axis] = -g[axis + 3] - g[axis + 6] - g[axis + 9];
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += g[i] * g[i];
    if (sum < 1e-12) return;
    const volume = ax * g[3] + ay * g[4] + az * g[5];
    const delta = (-(volume - tetra.volume) - compliance * tetra.lambda) / (sum + compliance);
    tetra.lambda += delta;
    for (let i = 0; i < 4; i++) {
      for (let axis = 0; axis < 3; axis++) p[tetra.ids[i] * 3 + axis] += delta * g[i * 3 + axis];
    }
  }

  get volumeRatio(): number {
    let current = 0;
    let initial = 0;
    for (const tetra of this.tetrahedra) {
      current += Math.abs(this.signedVolume(tetra.ids));
      initial += Math.abs(tetra.volume);
    }
    return current / initial;
  }

  get kineticEnergy(): number {
    let sum = 0;
    for (const velocity of this.velocities) sum += velocity * velocity;
    return sum / this.count;
  }
}

export type SkinBinding = { indices: Int32Array; weights: Float32Array };

export function bindSkin(vertices: Float32Array, physics: JellyPhysics): SkinBinding {
  const count = vertices.length / 3;
  const indices = new Int32Array(count * 8);
  const weights = new Float32Array(count * 8);
  const n = physics.divisions;
  for (let i = 0; i < count; i++) {
    const coordinates = [
      (vertices[i * 3] / JELLY_SIZE[0] + 0.5) * n,
      (vertices[i * 3 + 1] / JELLY_SIZE[1] + 0.5) * n,
      (vertices[i * 3 + 2] / JELLY_SIZE[2] + 0.5) * n,
    ];
    const cell = coordinates.map(function floor(v) { return Math.max(0, Math.min(n - 1, Math.floor(v))); });
    const fraction = coordinates.map(function fraction(v, axis) { return Math.max(0, Math.min(1, v - cell[axis])); });
    let corner = 0;
    for (let z = 0; z <= 1; z++) {
      for (let y = 0; y <= 1; y++) {
        for (let x = 0; x <= 1; x++) {
          const j = i * 8 + corner++;
          indices[j] = physics.index(cell[0] + x, cell[1] + y, cell[2] + z) * 3;
          weights[j] = (x ? fraction[0] : 1 - fraction[0]) * (y ? fraction[1] : 1 - fraction[1]) * (z ? fraction[2] : 1 - fraction[2]);
        }
      }
    }
  }
  return { indices, weights };
}

export function deformSkin(output: Float32Array, binding: SkinBinding, physics: JellyPhysics): void {
  const { indices, weights } = binding;
  for (let i = 0; i < output.length / 3; i++) {
    for (let axis = 0; axis < 3; axis++) {
      let value = 0;
      for (let corner = 0; corner < 8; corner++) {
        const j = i * 8 + corner;
        value += physics.positions[indices[j] + axis] * weights[j];
      }
      output[i * 3 + axis] = value;
    }
  }
}
