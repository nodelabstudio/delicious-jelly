import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CUBE_SIZE, createCubeGeometry } from './cube';
import { bindSkin, deformSkin, FLOOR, JellyPhysics } from './physics';

test('the jello cube has closed rounded edges and six finely subdivided flat faces', function () {
  const geometry = createCubeGeometry();
  const positions = geometry.getAttribute('position');
  const indices = geometry.getIndex()!;
  const edges = new Map<string, number>();
  const flatFaces = new Set<string>();
  let volume = 0;
  assert.ok(positions.count > 5000 && positions.count < 15000, `Surface resolution: ${positions.count}`);
  for (let i = 0; i < positions.count; i++) {
    const point = [positions.getX(i), positions.getY(i), positions.getZ(i)];
    assert.ok(point.every(Number.isFinite));
    const offsets = point.map(function roundedDistance(value, axis) {
      assert.ok(Math.abs(value) <= CUBE_SIZE[axis] / 2 + 1e-6);
      return Math.max(Math.abs(value) - (CUBE_SIZE[axis] / 2 - 0.24), 0);
    });
    assert.ok(Math.abs(Math.hypot(...offsets) - 0.24) < 1e-6, 'Vertices lie on a rounded-box surface');
    for (let axis = 0; axis < 3; axis++) {
      const centerOfFace = point.every(function nearCenter(value, coordinate) { return coordinate === axis || Math.abs(value) < 0.7; });
      if (centerOfFace && Math.abs(Math.abs(point[axis]) - CUBE_SIZE[axis] / 2) < 1e-6) {
        flatFaces.add(`${axis}:${Math.sign(point[axis])}`);
      }
    }
  }
  assert.equal(flatFaces.size, 6, 'The shape is a cube, not a rounded blob');
  for (let i = 0; i < indices.count; i += 3) {
    const ids = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
    assert.equal(new Set(ids).size, 3);
    for (let j = 0; j < 3; j++) {
      const a = ids[j];
      const b = ids[(j + 1) % 3];
      const edge = `${Math.min(a, b)}:${Math.max(a, b)}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
    const [a, b, c] = ids;
    volume += (
      positions.getX(a) * (positions.getY(b) * positions.getZ(c) - positions.getZ(b) * positions.getY(c))
      + positions.getY(a) * (positions.getZ(b) * positions.getX(c) - positions.getX(b) * positions.getZ(c))
      + positions.getZ(a) * (positions.getX(b) * positions.getY(c) - positions.getY(b) * positions.getX(c))
    ) / 6;
  }
  assert.ok([...edges.values()].every(function paired(count) { return count === 2; }), 'Every edge has two faces');
  assert.ok(volume > CUBE_SIZE[0] ** 3 * 0.9 && volume < CUBE_SIZE[0] ** 3, 'Outward-facing rounded cube volume');
  geometry.dispose();
});

test('cube skin keeps its rest shape and rainbow layers while bouncing', function () {
  const geometry = createCubeGeometry();
  const positions = geometry.getAttribute('position').array as Float32Array;
  const original = positions.slice();
  const heights = geometry.getAttribute('moldHeight').array.slice();
  const body = new JellyPhysics(CUBE_SIZE);
  const binding = bindSkin(positions, body);
  deformSkin(positions, binding, body);
  for (let i = 0; i < positions.length; i++) {
    const offset = i % 3 === 1 ? CUBE_SIZE[1] / 2 + FLOOR : 0;
    assert.ok(Math.abs(positions[i] - original[i] - offset) < 1e-5);
  }
  assert.ok(heights.every(function normalized(height) { return height >= -1e-6 && height <= 1 + 1e-6; }));
  body.nudge();
  for (let i = 0; i < 90; i++) body.step();
  deformSkin(positions, binding, body);
  assert.ok(positions.every(Number.isFinite));
  for (let i = 1; i < positions.length; i += 3) assert.ok(positions[i] >= FLOOR - 1e-6);
  assert.deepEqual(geometry.getAttribute('moldHeight').array, heights);
  geometry.dispose();
});

test('the cube remains stable after stretching and resets exactly at either softness extreme', function () {
  for (const softness of [0, 100]) {
    const body = new JellyPhysics(CUBE_SIZE);
    body.squishiness = softness;
    body.startGrab([1, 2.2, 1]);
    body.moveGrab([1, 1.1, 0.4]);
    for (let i = 0; i < 75; i++) body.step();
    body.endGrab();
    for (let i = 0; i < 480; i++) body.step();
    assert.ok(body.positions.every(Number.isFinite));
    for (let i = 1; i < body.positions.length; i += 3) assert.ok(body.positions[i] >= FLOOR);
    assert.ok(body.volumeRatio > 0.85 && body.volumeRatio < 1.15, `Cube volume ratio: ${body.volumeRatio}`);
    body.reset();
    assert.deepEqual(body.positions, body.rest);
    assert.equal(body.kineticEnergy, 0);
  }
});
