import { BufferGeometry, DynamicDrawUsage, Float32BufferAttribute, MeshBasicMaterial, Vector3 } from 'three/webgpu';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Point } from './physics';

export const BEAR_SIZE: Point = [2.65, 3.4, 1.72];

function ellipsoid(x: number, y: number, z: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): number {
  return (Math.hypot((x - cx) / rx, (y - cy) / ry, (z - cz) / rz) - 1) * Math.min(rx, ry, rz);
}

function smoothUnion(a: number, b: number, radius: number): number {
  const h = Math.max(radius - Math.abs(a - b), 0) / radius;
  return Math.min(a, b) - h * h * radius * 0.25;
}

/** A single candy surface, including embossed features, without intersecting glass shells. */
function bearField(x: number, y: number, z: number): number {
  let body = ellipsoid(x, y, z, 0, -0.26, 0, 0.65, 0.88, 0.46);
  body = smoothUnion(body, ellipsoid(x, y, z, 0, 0.89, 0, 0.69, 0.65, 0.46), 0.17);
  for (const side of [-1, 1]) {
    body = smoothUnion(body, ellipsoid(x, y, z, side * 0.56, 1.4, 0, 0.29, 0.3, 0.27), 0.085);
    body = smoothUnion(body, ellipsoid(x, y, z, side * 0.76, -0.2, 0.025, 0.29, 0.55, 0.3), 0.11);
    body = smoothUnion(body, ellipsoid(x, y, z, side * 0.4, -1.08, 0.16, 0.38, 0.43, 0.48), 0.085);
    body = smoothUnion(body, ellipsoid(x, y, z, side * 0.255, 1.07, 0.416, 0.09, 0.105, 0.062), 0.025);
    const innerEar = ellipsoid(x, y, z, side * 0.56, 1.425, 0.245, 0.16, 0.18, 0.105);
    body = -smoothUnion(-body, innerEar, 0.035);
  }
  body = smoothUnion(body, ellipsoid(x, y, z, 0, 0.72, 0.44, 0.36, 0.24, 0.18), 0.045);
  body = smoothUnion(body, ellipsoid(x, y, z, 0, 0.85, 0.59, 0.125, 0.095, 0.075), 0.025);
  const smile = Math.max(Math.hypot(Math.hypot(x, (y - 0.8) * 1.1) - 0.17, z - 0.593) - 0.024, y - 0.73);
  return -smoothUnion(-body, smile, 0.012);
}

export function createBearGeometry(): BufferGeometry {
  const resolution = 64;
  const material = new MeshBasicMaterial();
  const surface = new MarchingCubes(resolution, material, false, false, 40000);
  const extent: Point = [1.55, 1.95, 1.05];
  surface.isolation = 0;
  for (let z = 0; z < resolution; z++) {
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        surface.field[x + y * resolution + z * resolution * resolution] = -bearField(
          (x / resolution * 2 - 1) * extent[0],
          (y / resolution * 2 - 1) * extent[1],
          (z / resolution * 2 - 1) * extent[2],
        );
      }
    }
  }
  surface.update();
  const triangles = new BufferGeometry();
  triangles.setAttribute('position', new Float32BufferAttribute(surface.positionArray.slice(0, surface.count * 3), 3));
  triangles.scale(...extent);
  // Welding lets normals stay smooth across the surface as the physics cage deforms it.
  const geometry = mergeVertices(triangles, 1e-5);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const center = bounds.getCenter(new Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  const scale = BEAR_SIZE[1] / (bounds.max.y - bounds.min.y);
  geometry.scale(scale, scale, scale);
  const positions = geometry.getAttribute('position') as Float32BufferAttribute;
  positions.setUsage(DynamicDrawUsage);
  const heights = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++) heights[i] = positions.getY(i) / BEAR_SIZE[1] + 0.5;
  geometry.setAttribute('moldHeight', new Float32BufferAttribute(heights, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  triangles.dispose();
  surface.geometry.dispose();
  material.dispose();
  return geometry;
}
