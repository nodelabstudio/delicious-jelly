import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindSkin, deformSkin, FLOOR, JELLY_SIZE, JellyPhysics } from './physics';
import { createMoldGeometry } from './mold';

function advance(body: JellyPhysics, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 120); i++) body.step();
}

function assertHealthy(body: JellyPhysics): void {
  assert.ok(body.positions.every(Number.isFinite), 'All particles must stay finite');
  for (let i = 1; i < body.positions.length; i += 3) assert.ok(body.positions[i] >= FLOOR, 'No floor penetration');
  assert.ok(body.volumeRatio > 0.85 && body.volumeRatio < 1.15, `Volume ratio ${body.volumeRatio}`);
}

test('settles under gravity without collapsing or penetrating the floor', function () {
  const body = new JellyPhysics();
  advance(body, 4);
  assertHealthy(body);
  assert.ok(body.kineticEnergy < 0.15, `Resting energy ${body.kineticEnergy}`);
});

test('a nudge lifts the jelly, then damping returns it to rest', function () {
  const body = new JellyPhysics();
  body.nudge();
  advance(body, 0.2);
  assert.ok(body.positions[1] > FLOOR + 0.3);
  assertHealthy(body);
  advance(body, 6);
  assertHealthy(body);
  assert.ok(body.kineticEnergy < 0.25, `Settled energy ${body.kineticEnergy}`);
});

test('drag, release, and reset remain stable at both softness extremes', function () {
  for (const squishiness of [0, 100]) {
    const body = new JellyPhysics();
    body.squishiness = squishiness;
    body.startGrab([0, 2.2, 1]);
    body.moveGrab([1.3, 1.2, 0.3]);
    advance(body, 0.65);
    assert.ok(body.positions.every(Number.isFinite));
    body.endGrab();
    advance(body, 4);
    assertHealthy(body);
    body.reset();
    assert.deepEqual(body.positions, body.rest);
    assert.equal(body.kineticEnergy, 0);
    assert.ok(Math.abs(body.volumeRatio - 1) < 1e-10);
  }
});

test('trilinear skinning preserves rest shape and follows particle translation', function () {
  const body = new JellyPhysics();
  const vertices = new Float32Array([0, 0, 0, 0.5, 0.7, -0.2]);
  const binding = bindSkin(vertices, body);
  const output = new Float32Array(vertices.length);
  deformSkin(output, binding, body);
  assert.ok(Math.abs(output[0]) < 1e-6);
  assert.ok(Math.abs(output[1] - (JELLY_SIZE[1] / 2 + FLOOR)) < 1e-6);
  for (let i = 0; i < body.positions.length; i += 3) body.positions[i] += 1;
  deformSkin(output, binding, body);
  assert.ok(Math.abs(output[0] - 1) < 1e-6);
  assert.ok(Math.abs(output[3] - 1.5) < 1e-6);
});

test('rejects an unsafe timestep', function () {
  const body = new JellyPhysics();
  assert.throws(function () { body.step(1); }, RangeError);
});

test('the mold is closed, outward-facing, and keeps its center opening', function () {
  const geometry = createMoldGeometry();
  const positions = geometry.getAttribute('position');
  const indices = geometry.getIndex()!;
  const edgeCounts = new Map<string, number>();
  let volume = 0;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    assert.ok(Math.hypot(x, z) > 0.35, 'The center stays open');
    assert.ok(Math.abs(x) <= JELLY_SIZE[0] / 2 && Math.abs(z) <= JELLY_SIZE[2] / 2, 'Mold fits its deformation cage');
    assert.ok(Math.abs(y) <= JELLY_SIZE[1] / 2 + 1e-6);
  }
  for (let i = 0; i < indices.count; i += 3) {
    const ids = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
    for (let j = 0; j < 3; j++) {
      const a = ids[j];
      const b = ids[(j + 1) % 3];
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
    const [a, b, c] = ids;
    volume += (
      positions.getX(a) * (positions.getY(b) * positions.getZ(c) - positions.getZ(b) * positions.getY(c))
      + positions.getY(a) * (positions.getZ(b) * positions.getX(c) - positions.getX(b) * positions.getZ(c))
      + positions.getZ(a) * (positions.getX(b) * positions.getY(c) - positions.getY(b) * positions.getX(c))
    ) / 6;
  }
  assert.ok([...edgeCounts.values()].every(function paired(count) { return count === 2; }), 'Every edge has two faces');
  assert.ok(volume > 0, 'Surface normals face outward');

  const body = new JellyPhysics();
  const restHeights = geometry.getAttribute('moldHeight').array.slice();
  const skin = bindSkin(positions.array as Float32Array, body);
  body.nudge();
  advance(body, 0.15);
  deformSkin(positions.array as Float32Array, skin, body);
  assert.deepEqual(geometry.getAttribute('moldHeight').array, restHeights, 'Rainbow bands retain material-space coordinates');
  geometry.dispose();
});
