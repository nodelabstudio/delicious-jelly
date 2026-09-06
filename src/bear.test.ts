import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BEAR_SIZE, createBearGeometry } from './bear';
import { bindSkin, deformSkin, FLOOR, JellyPhysics } from './physics';

test('the gummy bear is a single closed, outward-facing surface inside its cage', function () {
  const geometry = createBearGeometry();
  const positions = geometry.getAttribute('position');
  const heights = geometry.getAttribute('moldHeight');
  const indices = geometry.getIndex()!;
  const edges = new Map<string, number>();
  const neighbors = Array.from({ length: positions.count }, function emptyNeighbors() { return new Set<number>(); });
  let volume = 0;
  assert.ok(positions.count > 5000 && positions.count < 35000, `Practical surface resolution: ${positions.count}`);
  for (let i = 0; i < positions.count; i++) {
    const xyz = [positions.getX(i), positions.getY(i), positions.getZ(i)];
    assert.ok(xyz.every(Number.isFinite));
    for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(xyz[axis]) <= BEAR_SIZE[axis] / 2 + 1e-6, 'Surface fits its deformation cage');
    assert.ok(heights.getX(i) >= -1e-6 && heights.getX(i) <= 1 + 1e-6);
  }
  for (let i = 0; i < indices.count; i += 3) {
    const ids = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
    assert.equal(new Set(ids).size, 3, 'Triangles do not collapse to an edge');
    for (let j = 0; j < 3; j++) {
      const a = ids[j];
      const b = ids[(j + 1) % 3];
      const edge = `${Math.min(a, b)}:${Math.max(a, b)}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
      neighbors[a].add(b);
      neighbors[b].add(a);
    }
    const [a, b, c] = ids;
    volume += (
      positions.getX(a) * (positions.getY(b) * positions.getZ(c) - positions.getZ(b) * positions.getY(c))
      + positions.getY(a) * (positions.getZ(b) * positions.getX(c) - positions.getX(b) * positions.getZ(c))
      + positions.getZ(a) * (positions.getX(b) * positions.getY(c) - positions.getY(b) * positions.getX(c))
    ) / 6;
  }
  assert.ok([...edges.values()].every(function paired(count) { return count === 2; }), 'Every edge has two faces');
  assert.ok(volume > 0, 'Normals point outward');
  const visited = new Set<number>([0]);
  const queue = [0];
  for (let i = 0; i < queue.length; i++) {
    for (const neighbor of neighbors[queue[i]]) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  assert.equal(visited.size, positions.count, 'Ears, face, belly, and paws all belong to one surface');
  geometry.dispose();
});

test('bear skin preserves its proportions, rainbow coordinates, and floor contact', function () {
  const geometry = createBearGeometry();
  const positions = geometry.getAttribute('position').array as Float32Array;
  const rest = positions.slice();
  const heights = geometry.getAttribute('moldHeight').array.slice();
  const body = new JellyPhysics(BEAR_SIZE);
  const binding = bindSkin(positions, body);
  deformSkin(positions, binding, body);
  for (let i = 0; i < positions.length; i++) {
    const offset = i % 3 === 1 ? BEAR_SIZE[1] / 2 + FLOOR : 0;
    assert.ok(Math.abs(positions[i] - rest[i] - offset) < 1e-5, 'Rest shape is not clamped or flattened');
  }
  body.nudge();
  for (let step = 0; step < 90; step++) body.step();
  deformSkin(positions, binding, body);
  assert.ok(positions.every(Number.isFinite));
  for (let i = 1; i < positions.length; i += 3) assert.ok(positions[i] >= FLOOR - 1e-6);
  assert.deepEqual(geometry.getAttribute('moldHeight').array, heights);
  body.reset();
  assert.deepEqual(body.positions, body.rest);
  geometry.dispose();
});

test('the taller bear cage remains stable through grabbing at both softness extremes', function () {
  for (const softness of [0, 100]) {
    const body = new JellyPhysics(BEAR_SIZE);
    body.squishiness = softness;
    body.startGrab([0.55, 3.15, 0.3]);
    body.moveGrab([0.7, 0.7, 0.4]);
    for (let i = 0; i < 60; i++) body.step();
    body.endGrab();
    for (let i = 0; i < 480; i++) body.step();
    assert.ok(body.positions.every(Number.isFinite));
    for (let i = 1; i < body.positions.length; i += 3) assert.ok(body.positions[i] >= FLOOR);
    assert.ok(body.volumeRatio > 0.85 && body.volumeRatio < 1.15, `Bear volume ratio: ${body.volumeRatio}`);
  }
});
