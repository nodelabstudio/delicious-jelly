import { BufferGeometry, Float32BufferAttribute, DynamicDrawUsage } from 'three/webgpu';
import { JELLY_SIZE } from './physics';

/** A closed, scalloped ring with a tapered wall and rounded mold shoulders. */
export function createMoldGeometry(): BufferGeometry {
  const around = 160;
  const profile = 64;
  const positions: Array<number> = [];
  const heights: Array<number> = [];
  const indices: Array<number> = [];

  for (let ring = 0; ring < around; ring++) {
    const angle = ring / around * Math.PI * 2;
    const flute = Math.cos(angle * 16);
    for (let slice = 0; slice < profile; slice++) {
      const section = slice / profile * Math.PI * 2;
      const sin = Math.sin(section);
      const cos = Math.cos(section);
      // A superellipse makes broad walls and a rounded shoulder, rather than a doughnut tube.
      const y = Math.sign(sin) * Math.abs(sin) ** 0.48 * JELLY_SIZE[1] / 2;
      const height = y / JELLY_SIZE[1] + 0.5;
      const inner = 0.39 + height * 0.10;
      const outer = 1.56 - height * 0.20;
      const middle = (inner + outer) / 2;
      const halfWidth = (outer - inner) / 2;
      const radial = Math.sign(cos) * Math.abs(cos) ** 0.48;
      const scallop = flute * (0.018 + 0.06 * (radial + 1) / 2);
      const radius = middle + halfWidth * radial + scallop;
      positions.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      // Rest-space height keeps the rainbow layers attached as the jelly stretches.
      heights.push(height);

      const a = ring * profile + slice;
      const b = ((ring + 1) % around) * profile + slice;
      const c = ((ring + 1) % around) * profile + (slice + 1) % profile;
      const d = ring * profile + (slice + 1) % profile;
      indices.push(a, d, b, b, d, c);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute('moldHeight', new Float32BufferAttribute(heights, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
