import { BoxGeometry, BufferGeometry, DynamicDrawUsage, Float32BufferAttribute } from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Point } from './physics';

export const CUBE_SIZE: Point = [2.45, 2.45, 2.45];
const CORNER_RADIUS = 0.24;

/** Broad, finely subdivided faces let the cube flex between its rounded edges. */
export function createCubeGeometry(): BufferGeometry {
  const box = new BoxGeometry(...CUBE_SIZE, 40, 40, 40);
  const positions = box.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const point = [positions.getX(i), positions.getY(i), positions.getZ(i)];
    const inner = point.map(function clamp(value, axis) {
      const limit = CUBE_SIZE[axis] / 2 - CORNER_RADIUS;
      return Math.max(-limit, Math.min(limit, value));
    });
    const offset = point.map(function difference(value, axis) { return value - inner[axis]; });
    const scale = CORNER_RADIUS / Math.hypot(...offset);
    positions.setXYZ(i, inner[0] + offset[0] * scale, inner[1] + offset[1] * scale, inner[2] + offset[2] * scale);
  }

  // Weld positions without the box's per-face UV seams so deformation stays watertight.
  const surface = new BufferGeometry();
  surface.setAttribute('position', positions);
  surface.setIndex(box.getIndex());
  const geometry = mergeVertices(surface, 1e-5);
  const vertices = geometry.getAttribute('position') as Float32BufferAttribute;
  vertices.setUsage(DynamicDrawUsage);
  const heights = new Float32Array(vertices.count);
  for (let i = 0; i < vertices.count; i++) heights[i] = vertices.getY(i) / CUBE_SIZE[1] + 0.5;
  geometry.setAttribute('moldHeight', new Float32BufferAttribute(heights, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  surface.dispose();
  box.dispose();
  return geometry;
}
