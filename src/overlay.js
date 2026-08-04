import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createPlushTypography } from './createPlushTypography.js';
import videoUrl from '../source/EID-1978_Lesson-Plans-Monday-no-subtitles.mp4?url';
import './overlay.css';

const query = new URLSearchParams(window.location.search);
const captureMode = query.has('capture');
if (query.has('debug')) document.body.classList.add('debug');

const video = document.querySelector('#source-video');
video.src = videoUrl;
video.muted = true;
video.loop = false;
video.playsInline = true;

const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: captureMode });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.querySelector('#overlay-app').appendChild(renderer.domElement);

const camera = new THREE.OrthographicCamera(-2.25, 2.25, 4.0, -4.0, 0.1, 100);
camera.position.set(0, 0, 10);

function resize() {
  const aspect = window.innerWidth / window.innerHeight;
  const viewHeight = 8.2;
  const halfHeight = viewHeight * 0.5;
  const halfWidth = halfHeight * aspect;
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

resize();
window.addEventListener('resize', resize);

scene.add(new THREE.HemisphereLight(0xffeadb, 0x1a1427, 2.4));
const key = new THREE.DirectionalLight(0xffd7bd, 3.4);
key.position.set(-3.4, 4.8, 7.0);
key.castShadow = true;
scene.add(key);
const fill = new THREE.DirectionalLight(0x8fbcff, 2.0);
fill.position.set(5.5, 0.8, 3.0);
scene.add(fill);
const rim = new THREE.PointLight(0xff5bbf, 12, 7, 2);
rim.position.set(-2.6, 1.4, -1.6);
scene.add(rim);

const phrase = 'Teachers: How to create a lesson plan in 30 seconds';
const typography = await createPlushTypography({ phrase, layout: 'overlay' });
typography.position.set(0, -0.72, 0);
typography.rotation.set(0.055, -0.28, 0);
scene.add(typography);

function makeRoundedPanel(width, height, radius) {
  const shape = new THREE.Shape();
  const x = -width * 0.5;
  const y = -height * 0.5;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({
      color: 0x0e1018,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    }),
  );
}

const panel = makeRoundedPanel(4.65, 3.08, 0.20);
panel.position.set(0, -1.10, -0.32);
panel.rotation.y = -0.14;
panel.renderOrder = -1;
panel.visible = !query.has('nopanel');
scene.add(panel);

const shadowPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(4.68, 3.08),
  new THREE.ShadowMaterial({ color: 0x08070b, opacity: 0.22 }),
);
shadowPlane.position.set(0, -1.10, -0.28);
shadowPlane.rotation.y = -0.14;
shadowPlane.receiveShadow = true;
shadowPlane.renderOrder = -2;
scene.add(shadowPlane);

await RAPIER.init();
const physicsWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
const physicsState = { records: [], elapsed: 0, lastTime: performance.now(), running: false };

typography.updateMatrixWorld(true);
typography.traverse((node) => {
  if (!node.name.startsWith('glyph.') || !node.userData?.physics) return;
  const physicsData = node.userData.physics;
  const parent = node.parent;
  const worldScale = node.getWorldScale(new THREE.Vector3());
  const centerOffset = new THREE.Vector3(...physicsData.centerOffset);
  const targetPosition = node.localToWorld(centerOffset.clone());
  const targetQuaternion = node.getWorldQuaternion(new THREE.Quaternion());
  const index = physicsState.records.length;
  const side = index % 3 === 0 ? -1 : 1;
  const isTopLine = parent.name === 'line-top';
  const startOffset = isTopLine
    ? new THREE.Vector3(
      side * (2.25 + (index % 5) * 0.19),
      ((index % 3) - 1) * 0.10,
      0.18 + (index % 3) * 0.12,
    )
    : new THREE.Vector3(
      side * (2.0 + (index % 5) * 0.19),
      -0.42 - (index % 3) * 0.20,
      0.18 + (index % 3) * 0.12,
    );
  const startPosition = targetPosition.clone().add(startOffset);
  const startQuaternion = targetQuaternion.clone().multiply(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(
      ((index % 5) - 2) * 0.13,
      ((index % 4) - 1.5) * 0.17,
      ((index % 7) - 3) * 0.14,
    )),
  );
  const body = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(startPosition.x, startPosition.y, startPosition.z)
      .setRotation({ x: startQuaternion.x, y: startQuaternion.y, z: startQuaternion.z, w: startQuaternion.w })
      .setAdditionalMass(physicsData.mass)
      .setLinearDamping(4.2)
      .setAngularDamping(4.8)
      .setCanSleep(false),
  );
  const worldHalfExtents = new THREE.Vector3(
    physicsData.halfExtents[0] * worldScale.x,
    physicsData.halfExtents[1] * worldScale.y,
    physicsData.halfExtents[2] * worldScale.z,
  );
  const collider = physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(worldHalfExtents.x, worldHalfExtents.y, worldHalfExtents.z)
      .setFriction(0.72)
      .setRestitution(0.24),
    body,
  );
  body.setGravityScale(0, true);
  const record = {
    id: node.name,
    character: node.userData.character,
    visual: node,
    parent,
    centerOffset,
    worldScale,
    body,
    collider,
    targetPosition,
    targetQuaternion,
    startPosition,
    startQuaternion,
    phase: index * 1.61803398875,
    delay: 0.04 + (index % 15) * 0.035,
    softVariation: 0.88 + (index % 5) * 0.035,
    softHit: false,
  };
  node.userData.overlayPhysicsBodyId = record.id;
  node.userData.overlayPhysicsBody = body;
  node.traverse((child) => {
    if (child.isMesh) child.userData.glyphRoot = node;
  });
  physicsState.records.push(record);
});

function syncRecord(record) {
  const translation = record.body.translation();
  const rotation = record.body.rotation();
  const bodyQuaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  const scaledOffset = record.centerOffset.clone().multiply(record.worldScale).applyQuaternion(bodyQuaternion);
  const worldPosition = new THREE.Vector3(translation.x, translation.y, translation.z).sub(scaledOffset);
  record.visual.position.copy(record.parent.worldToLocal(worldPosition));
  const parentQuaternion = record.parent.getWorldQuaternion(new THREE.Quaternion());
  const localQuaternion = parentQuaternion.invert().multiply(bodyQuaternion);
  record.visual.quaternion.copy(localQuaternion);
  record.visual.userData.setSoftBaseQuaternion?.(localQuaternion);
}

function springProgress(time) {
  if (time <= 0) return 0;
  const value = 1 - Math.exp(-7.2 * time) * (Math.cos(12.6 * time) + 0.30 * Math.sin(12.6 * time));
  return Math.max(0, Math.min(1.12, value));
}

function triggerSoftLanding(record) {
  if (record.softHit) return;
  const direction = record.startPosition.x >= record.targetPosition.x ? 1 : -1;
  record.visual.userData.triggerSquash?.(0.36 * record.softVariation, direction);
  record.softHit = true;
}

function setAnalyticPose(seconds) {
  physicsState.elapsed = seconds;
  for (const record of physicsState.records) {
    const localTime = seconds - record.delay;
    const progress = springProgress(localTime);
    const target = record.targetPosition.clone();
    const offset = record.startPosition.clone().sub(target).multiplyScalar(1 - progress);
    if (localTime > 0) {
      const settle = Math.exp(-3.4 * localTime);
      offset.y += Math.sin(localTime * 15.4 + record.phase) * 0.12 * settle;
      offset.x += Math.sin(localTime * 10.2 + record.phase * 0.7) * 0.06 * settle;
    }
    const position = target.add(offset);
    const rotation = record.startQuaternion.clone().slerp(record.targetQuaternion, Math.max(0, Math.min(1, progress)));
    if (localTime > 0) {
      const settleRotation = Math.exp(-3.8 * localTime);
      rotation.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(
        Math.sin(localTime * 14.1 + record.phase) * 0.08 * settleRotation,
        Math.cos(localTime * 12.7 + record.phase) * 0.07 * settleRotation,
        Math.sin(localTime * 16.5 + record.phase) * 0.10 * settleRotation,
      )));
    }
    record.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    record.body.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }, true);
    syncRecord(record);
    triggerSoftLanding(record);
    record.visual.userData.updateSoftBody?.(1 / 30, 0.006);
  }
}

function resetBodies() {
  physicsState.elapsed = 0;
  physicsState.lastTime = performance.now();
  for (const record of physicsState.records) {
    record.body.setTranslation({ x: record.startPosition.x, y: record.startPosition.y, z: record.startPosition.z }, true);
    record.body.setRotation({ x: record.startQuaternion.x, y: record.startQuaternion.y, z: record.startQuaternion.z, w: record.startQuaternion.w }, true);
    record.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    record.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    record.body.wakeUp();
    record.visual.userData.resetSoftBody?.();
    record.softHit = false;
  }
}

function stepPhysics(delta) {
  physicsState.elapsed += delta;
  for (const record of physicsState.records) {
    const localTime = physicsState.elapsed - record.delay;
    if (localTime <= 0) continue;
    const position = record.body.translation();
    const velocity = record.body.linvel();
    const error = new THREE.Vector3(
      record.targetPosition.x - position.x,
      record.targetPosition.y - position.y,
      record.targetPosition.z - position.z,
    );
    const impulse = error.multiplyScalar(10.5 * delta);
    impulse.x -= velocity.x * 3.1 * delta;
    impulse.y -= velocity.y * 3.1 * delta;
    impulse.z -= velocity.z * 3.1 * delta;
    record.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    const currentRotation = record.body.rotation();
    const currentQuaternion = new THREE.Quaternion(currentRotation.x, currentRotation.y, currentRotation.z, currentRotation.w);
    currentQuaternion.slerp(record.targetQuaternion, Math.min(1, delta * 7.0));
    record.body.setRotation({ x: currentQuaternion.x, y: currentQuaternion.y, z: currentQuaternion.z, w: currentQuaternion.w }, true);
    if (localTime < 0.25) {
      const kick = Math.exp(-7 * localTime);
      record.body.applyTorqueImpulse({
        x: Math.cos(record.phase) * 0.10 * kick,
        y: Math.sin(record.phase * 0.7) * 0.08 * kick,
        z: Math.cos(record.phase * 1.3) * 0.12 * kick,
      }, true);
    }
    triggerSoftLanding(record);
  }
  physicsWorld.timestep = 1 / 60;
  physicsWorld.step();
  for (const record of physicsState.records) {
    syncRecord(record);
    record.visual.userData.updateSoftBody?.(1 / 60, 0.006);
  }
}

function renderFrame() {
  renderer.render(scene, camera);
}

function animationLoop(now) {
  const delta = Math.min((now - physicsState.lastTime) / 1000, 1 / 30);
  physicsState.lastTime = now;
  if (!captureMode && physicsState.running) stepPhysics(delta);
  renderFrame();
  requestAnimationFrame(animationLoop);
}

function replayHook() {
  resetBodies();
  physicsState.running = true;
  video.currentTime = 0;
  video.play().catch(() => {});
}

function impulseGlyph(id, impulse = { x: 0.2, y: 0.34, z: 0.42 }) {
  const record = physicsState.records.find((item) => item.id === id);
  if (!record) return false;
  physicsState.running = true;
  record.body.wakeUp();
  record.body.applyImpulse(impulse, true);
  record.body.applyTorqueImpulse({ x: impulse.z * 0.18, y: impulse.x * -0.14, z: impulse.y * 0.12 }, true);
  return true;
}

window.plushOverlay = {
  list: physicsState.records.map(({ id, character }) => ({ id, character })),
  reset: replayHook,
  impulse: impulseGlyph,
  getGlyph: (id) => physicsState.records.find((record) => record.id === id)?.visual ?? null,
};

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
renderer.domElement.addEventListener('pointerup', (event) => {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const meshes = [];
  typography.traverse((node) => {
    if (node.isMesh) meshes.push(node);
  });
  const hit = raycaster.intersectObjects(meshes, false)[0];
  const glyph = hit?.object?.userData?.glyphRoot;
  if (glyph?.userData?.overlayPhysicsBodyId) impulseGlyph(glyph.userData.overlayPhysicsBodyId);
});

window.overlayReady = false;
window.setOverlayTime = async (seconds, options = {}) => {
  if (!options.skipVideo) video.pause();
  const targetTime = Math.max(0, Math.min(seconds, Number.isFinite(video.duration) ? video.duration : seconds));
  if (!options.skipVideo && Math.abs(video.currentTime - targetTime) > 0.002) {
    await new Promise((resolve) => {
      const done = () => resolve();
      video.addEventListener('seeked', done, { once: true });
      video.currentTime = targetTime;
    });
  }
  setAnalyticPose(seconds);
  renderFrame();
  await new Promise((resolve) => requestAnimationFrame(resolve));
};

document.querySelector('#replay-hook')?.addEventListener('click', replayHook);
video.addEventListener('loadeddata', () => {
  window.overlayReady = true;
  if (!captureMode) replayHook();
});

resetBodies();
requestAnimationFrame(animationLoop);
video.load();
if (!captureMode) video.play().catch(() => {});
