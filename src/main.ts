import './style.css';
import * as THREE from 'three/webgpu';
import { attribute, color, float, fwidth, mix, positionWorld, smoothstep, uniform, vec4 } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import { createMoldGeometry } from './mold';
import { bindSkin, deformSkin, JELLY_SIZE, JellyPhysics } from './physics';
import type { Point } from './physics';

type Flavor = 'raspberry' | 'peach' | 'mint' | 'rainbow';
const flavors: Record<Flavor, { color: string; absorption: string; accent: string; tint: string }> = {
  raspberry: { color: '#fff0fa', absorption: '#d81a84', accent: '#bc4868', tint: '#f9e9ed' },
  peach: { color: '#fff7ee', absorption: '#ed7f2c', accent: '#b57540', tint: '#f8edde' },
  mint: { color: '#f0fff8', absorption: '#3d9f78', accent: '#508569', tint: '#e9f2ec' },
  rainbow: { color: '#fff3ef', absorption: '#ffffff', accent: '#9b597c', tint: '#f5e9f0' },
};

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}

const container = element<HTMLDivElement>('scene');
const wobbleButton = element<HTMLButtonElement>('wobble');
const resetButton = element<HTMLButtonElement>('reset');
const pauseButton = element<HTMLButtonElement>('pause');
const squishInput = element<HTMLInputElement>('squish');
const bounceInput = element<HTMLInputElement>('bounce');
const slowInput = element<HTMLInputElement>('slow');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const physics = new JellyPhysics();
let paused = reducedMotion.matches;
let dragging = false;
let dragDistance = 0;
let pointerId: number | null = null;
let activeFlavor: Flavor = 'raspberry';
let ready = false;
let accumulator = 0;
let disposed = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#f7f0ec');
scene.fog = new THREE.Fog('#f7f0ec', 12, 50);
const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 200);
camera.position.set(4.15, 4.4, 6.5);
const target = new THREE.Vector3(0, 1.05, 0);
camera.lookAt(target);

const renderer = new THREE.WebGPURenderer({
  antialias: true,
  alpha: false,
  // The query flag lets the same scene be verified on both renderer backends.
  forceWebGL: new URLSearchParams(window.location.search).get('renderer') === 'webgl',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.transmitted = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor('#f7f0ec', 1);
container.append(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.copy(target);
orbit.enablePan = false;
orbit.enableZoom = false;
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.minPolarAngle = Math.PI * 0.18;
orbit.maxPolarAngle = Math.PI * 0.47;
orbit.rotateSpeed = 0.4;
orbit.enabled = false;
orbit.update();
orbit.saveState();

const geometry = createMoldGeometry();
const position = geometry.getAttribute('position') as THREE.BufferAttribute;
const binding = bindSkin(position.array as Float32Array, physics);
const jellyMaterial = new THREE.MeshPhysicalNodeMaterial({
  color: flavors.raspberry.color,
  metalness: 0,
  roughness: 0.032,
  transmission: 1,
  // Optical path length approximates the width of the ring wall.
  thickness: 1.1,
  ior: 1.39,
  attenuationColor: flavors.raspberry.absorption,
  attenuationDistance: 2.3,
  clearcoat: 0.4,
  clearcoatRoughness: 0.018,
  dispersion: 0.008,
  envMapIntensity: 1.05,
});
const jelly = new THREE.Mesh(geometry, jellyMaterial);
jelly.castShadow = true;

const rainbowAmount = uniform(0);
const flavorColor = uniform(new THREE.Color(flavors.raspberry.color));
const flavorAbsorption = uniform(new THREE.Color(flavors.raspberry.absorption));
const moldHeight = attribute('moldHeight', 'float').toFloat();
const rainbowPalette = ['#5136b5', '#179bd8', '#25bc70', '#ffe23d', '#ff981e', '#f51d37'];
let rainbowBands = color(rainbowPalette[0]).toVec3();
for (let layer = 1; layer < rainbowPalette.length; layer++) {
  const boundary = layer / rainbowPalette.length;
  rainbowBands = mix(rainbowBands, color(rainbowPalette[layer]), smoothstep(boundary - 0.012, boundary + 0.012, moldHeight));
}
jellyMaterial.colorNode = mix(flavorColor, mix(rainbowBands, color('#ffffff'), 0.96), rainbowAmount);
const opticalAbsorption = mix(flavorAbsorption, rainbowBands, rainbowAmount);
jellyMaterial.attenuationColorNode = opticalAbsorption;
jellyMaterial.castShadowNode = vec4(mix(opticalAbsorption, color('#343035'), 0.3), 0.75);
scene.add(jelly);

// Tiny inclusions provide depth cues when the surface refracts the scene behind it.
const bubbleCount = 32;
const bubbleCenters = new Float32Array(bubbleCount * 3);
const bubbleRadii = new Float32Array(bubbleCount);
let seed = 413;
function random(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
for (let i = 0; i < bubbleCount; i++) {
  const angle = random() * Math.PI * 2;
  const radius = 0.94 + (random() - 0.5) * 0.4;
  bubbleCenters[i * 3] = Math.cos(angle) * radius;
  bubbleCenters[i * 3 + 1] = (random() - 0.5) * JELLY_SIZE[1] * 0.73;
  bubbleCenters[i * 3 + 2] = Math.sin(angle) * radius;
  bubbleRadii[i] = 0.007 + random() * 0.013;
}
const bubbleBinding = bindSkin(bubbleCenters, physics);
const bubblePositions = new Float32Array(bubbleCenters.length);
const bubbles = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 10, 8),
  new THREE.MeshPhysicalNodeMaterial({ color: '#fdf9f7', roughness: 0.035, metalness: 0, envMapIntensity: 0.8 }),
  bubbleCount,
);
bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
bubbles.frustumCulled = false;
scene.add(bubbles);
const bubbleMatrix = new THREE.Matrix4();

const floorMaterial = new THREE.MeshStandardNodeMaterial({ color: '#f7f0ec', roughness: 0.65 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
floor.receiveShadow = true;
scene.add(floor);

// Put the grid in the opaque floor shader so it is visible in the refraction pass.
const gridCoordinate = positionWorld.xz.mul(2);
const gridDistance = gridCoordinate.add(0.5).fract().sub(0.5).abs();
const gridWidth = fwidth(gridCoordinate).mul(0.45).max(0.001);
const gridEdgeX = smoothstep(gridWidth.x, gridWidth.x.mul(2), gridDistance.x);
const gridEdgeY = smoothstep(gridWidth.y, gridWidth.y.mul(2), gridDistance.y);
const gridLine = gridEdgeX.min(gridEdgeY).oneMinus();
const gridFade = float(1).sub(positionWorld.xz.length().div(12)).clamp(0, 1);
floorMaterial.colorNode = mix(color('#f7f0ec'), color('#bba5aa'), gridLine.mul(gridFade).mul(0.16));

// The same softbox positions define direct area lighting and reflected light cards.
const softboxes: Array<{ at: Point; width: number; height: number; intensity: number; color: string }> = [
  { at: [-3.5, 5, 3.5], width: 1.8, height: 3.2, intensity: 3.2, color: '#fff5e9' },
  { at: [4.5, 3, 1], width: 2.0, height: 3.0, intensity: 0.85, color: '#e7f0ff' },
  { at: [-1.5, 4, -4], width: 0.75, height: 2.6, intensity: 3.8, color: '#ffffff' },
];
THREE.RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
for (const source of softboxes) {
  const light = new THREE.RectAreaLight(source.color, source.intensity, source.width, source.height);
  light.position.set(...source.at);
  light.lookAt(target);
  scene.add(light);
}
scene.add(new THREE.HemisphereLight('#fff8f1', '#c6b4af', 1.15));

// Area lights do not cast shadow maps; an aligned spotlight supplies the key's shadow.
const keyLight = new THREE.SpotLight('#fff5e9', 65, 0, Math.PI / 3, 0.85, 2);
keyLight.name = 'Softbox key shadow';
keyLight.position.set(...softboxes[0].at);
keyLight.target.position.copy(target);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 24;
keyLight.shadow.bias = -0.0003;
keyLight.shadow.normalBias = 0.025;
keyLight.shadow.radius = 4;
scene.add(keyLight, keyLight.target);

function createStudio(): THREE.Scene {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color('#302b2d');
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(20, 15, 20),
    new THREE.MeshBasicNodeMaterial({ color: '#302b2d', side: THREE.BackSide }),
  );
  studio.add(room);

  for (const source of softboxes) {
    const light = new THREE.Mesh(
      new THREE.PlaneGeometry(source.width, source.height),
      new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(source.color).multiplyScalar(source.intensity), side: THREE.DoubleSide }),
    );
    light.position.set(...source.at);
    light.lookAt(target);
    studio.add(light);
  }
  return studio;
}

function resize(): void {
  const width = container.clientWidth;
  const height = container.clientHeight;
  const mobile = width <= 700;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.zoom = mobile ? Math.min(0.55, width / 820) : width < 1000 ? 0.71 : 0.83;
  camera.setViewOffset(width, height, mobile ? 0 : width * 0.065, mobile ? height / 2 - 350 : -height * 0.015, width, height);
  camera.updateProjectionMatrix();
}
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(container);
resize();

function updateSkin(): void {
  deformSkin(position.array as Float32Array, binding, physics);
  deformSkin(bubblePositions, bubbleBinding, physics);
  for (let i = 0; i < bubbleCount; i++) {
    bubbleMatrix.makeScale(bubbleRadii[i], bubbleRadii[i], bubbleRadii[i]);
    bubbleMatrix.setPosition(bubblePositions[i * 3], bubblePositions[i * 3 + 1], bubblePositions[i * 3 + 2]);
    bubbles.setMatrixAt(i, bubbleMatrix);
  }
  bubbles.instanceMatrix.needsUpdate = true;
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
}
updateSkin();

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragStart = new THREE.Vector3();
const dragPoint = new THREE.Vector3();
const viewDirection = new THREE.Vector3();

function setPointer(event: PointerEvent): void {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}

function endDrag(poke = false): void {
  if (!dragging) return;
  physics.endGrab(poke);
  dragging = false;
  if (pointerId !== null && renderer.domElement.hasPointerCapture(pointerId)) renderer.domElement.releasePointerCapture(pointerId);
  pointerId = null;
  orbit.enabled = ready;
  container.classList.remove('is-dragging');
}

renderer.domElement.addEventListener('pointerdown', function onPointerDown(event) {
  if (!ready || paused || dragging || event.button !== 0) return;
  setPointer(event);
  const hit = raycaster.intersectObject(jelly)[0];
  if (!hit) return;
  event.stopImmediatePropagation();
  event.preventDefault();
  orbit.enabled = false;
  dragging = true;
  pointerId = event.pointerId;
  dragDistance = 0;
  dragStart.copy(hit.point);
  camera.getWorldDirection(viewDirection);
  dragPlane.setFromNormalAndCoplanarPoint(viewDirection, hit.point);
  physics.startGrab(hit.point.toArray() as Point);
  renderer.domElement.setPointerCapture(event.pointerId);
  container.classList.add('is-dragging');
}, { capture: true });

renderer.domElement.addEventListener('pointermove', function onPointerMove(event) {
  if (!ready) return;
  setPointer(event);
  if (dragging) {
    if (event.pointerId !== pointerId) return;
    if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
      dragPoint.sub(dragStart);
      dragDistance = Math.max(dragDistance, dragPoint.length());
      physics.moveGrab(dragPoint.toArray() as Point);
    }
  } else {
    container.classList.toggle('is-over', !paused && raycaster.intersectObject(jelly).length > 0);
  }
});
renderer.domElement.addEventListener('pointerup', function onPointerUp(event) {
  if (event.pointerId === pointerId) endDrag(dragDistance < 0.06);
});
renderer.domElement.addEventListener('pointercancel', function onPointerCancel() { endDrag(); });
renderer.domElement.addEventListener('lostpointercapture', function onLostCapture() { endDrag(); });
window.addEventListener('blur', function onBlur() { endDrag(); accumulator = 0; });

function updateRange(input: HTMLInputElement): void {
  input.style.background = `linear-gradient(to right, var(--accent) ${input.value}%, #e6dcda ${input.value}%)`;
}

function syncSliders(): void {
  physics.squishiness = Number(squishInput.value);
  physics.bounciness = Number(bounceInput.value);
  element('squish-value').textContent = physics.squishiness < 30 ? 'A little firm' : physics.squishiness > 75 ? 'Super soft' : 'Just right';
  element('bounce-value').textContent = physics.bounciness < 30 ? 'Nice and calm' : physics.bounciness > 75 ? 'Never enough' : 'Extra jiggly';
  updateRange(squishInput);
  updateRange(bounceInput);
}

function setFlavor(flavor: Flavor, animate = true): void {
  activeFlavor = flavor;
  const palette = flavors[flavor];
  jellyMaterial.color.set(palette.color);
  jellyMaterial.attenuationColor.set(palette.absorption);
  flavorColor.value.set(palette.color);
  flavorAbsorption.value.set(palette.absorption);
  rainbowAmount.value = flavor === 'rainbow' ? 1 : 0;
  document.documentElement.style.setProperty('--accent', palette.accent);
  document.documentElement.style.setProperty('--accent-soft', palette.tint);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-flavor]')) {
    const selected = button.dataset.flavor === flavor;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  element('announcement').textContent = `${flavor[0].toUpperCase()}${flavor.slice(1)} jelly selected.`;
  if (ready && animate && !paused && !reducedMotion.matches) physics.nudge();
}

function syncPause(): void {
  pauseButton.textContent = paused ? 'Resume' : 'Pause';
  pauseButton.setAttribute('aria-pressed', String(paused));
  element('interaction-hint').querySelector('strong')!.textContent = paused ? 'A moment of stillness.' : 'Go on. Give it a poke.';
  accumulator = 0;
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-flavor]')) {
  button.addEventListener('click', function chooseFlavor() { setFlavor(button.dataset.flavor as Flavor); });
}
squishInput.addEventListener('input', syncSliders);
bounceInput.addEventListener('input', syncSliders);
wobbleButton.addEventListener('click', function wobble() {
  if (!ready) return;
  paused = false;
  syncPause();
  physics.nudge();
  element('announcement').textContent = 'Wobble!';
});
pauseButton.addEventListener('click', function togglePause() {
  endDrag();
  paused = !paused;
  syncPause();
});
resetButton.addEventListener('click', function reset() {
  endDrag();
  physics.reset();
  squishInput.value = '55';
  bounceInput.value = '65';
  slowInput.checked = false;
  paused = reducedMotion.matches;
  syncSliders();
  syncPause();
  setFlavor('raspberry', false);
  orbit.reset();
  updateSkin();
  element('announcement').textContent = 'Jelly and controls reset.';
});
container.addEventListener('keydown', function keyboardWobble(event) {
  if (event.code === 'Space' || event.code === 'Enter') {
    event.preventDefault();
    wobbleButton.click();
  }
});
reducedMotion.addEventListener('change', function onMotionPreference(event) {
  if (event.matches) {
    endDrag();
    paused = true;
    syncPause();
  }
});
element('reload').addEventListener('click', function reload() { window.location.reload(); });
syncSliders();
syncPause();

function showError(error: unknown): void {
  console.error('Jelly renderer could not start:', error);
  ready = false;
  renderer.setAnimationLoop(null);
  element('loading').hidden = true;
  element('error').hidden = false;
  element('renderer-label').textContent = 'Graphics unavailable';
  element('status-dot').classList.remove('is-ready');
  for (const button of [wobbleButton, resetButton, pauseButton]) button.disabled = true;
}

async function start(): Promise<void> {
  await renderer.init();
  const studio = createStudio();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(studio, 0.025);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.85;
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  ready = true;
  orbit.enabled = true;
  element('loading').hidden = true;
  element('renderer-label').textContent = 'isWebGPUBackend' in renderer.backend ? 'WebGPU' : 'WebGL 2';
  element('status-dot').classList.add('is-ready');
  for (const button of [wobbleButton, resetButton, pauseButton]) button.disabled = false;
  if (!reducedMotion.matches) physics.nudge();

  let lastTime = performance.now();
  renderer.setAnimationLoop(function animate(time) {
    if (disposed) return;
    const dt = Math.max(0, Math.min((time - lastTime) / 1000, 0.05));
    lastTime = time;
    if (document.hidden) { accumulator = 0; return; }
    if (!paused) {
      accumulator += dt * (slowInput.checked ? 0.3 : 1);
      while (accumulator >= 1 / 120) {
        physics.step();
        accumulator -= 1 / 120;
      }
      updateSkin();
    }
    orbit.update();
    renderer.render(scene, camera);
  });

  function dispose(): void {
    disposed = true;
    renderer.setAnimationLoop(null);
    resizeObserver.disconnect();
    orbit.dispose();
    keyLight.shadow.dispose();
    scene.traverse(function disposeObject(object) {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
    environment.dispose();
    pmrem.dispose();
    studio.traverse(function disposeStudio(object) {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
    renderer.dispose();
  }
  window.addEventListener('pagehide', function onPageHide(event) { if (!event.persisted) dispose(); });

  if (import.meta.env.DEV) {
    Object.assign(window, {
      __jelly: {
        physics, renderer, camera, jelly,
        get state() { return { paused, dragging, activeFlavor, ready, slow: slowInput.checked }; },
      },
    });
  }
}

start().catch(showError);
