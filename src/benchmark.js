import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createPlushTypography } from './createPlushTypography.js';
import videoUrl from '../source/EID-1978_Lesson-Plans-Monday-no-subtitles.mp4?url';
import './benchmark.css';

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const FIXED_STEP = 1 / 60;
const phrase = 'Teachers: How to create a lesson plan in 30 seconds';

const video = document.querySelector('#benchmark-video');
video.src = videoUrl;
video.muted = true;
video.playsInline = true;
video.preload = 'auto';

const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, premultipliedAlpha: true });
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT, false);
renderer.setClearColor(0x08070b, 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.querySelector('#benchmark-app').appendChild(renderer.domElement);

const gpuInfo = (() => {
  const context = renderer.getContext();
  const debug = context.getExtension('WEBGL_debug_renderer_info');
  const vendor = context.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? context.VENDOR);
  const rendererName = context.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER);
  const isSwiftShader = /swiftshader|software|llvmpipe|llvmpipe/i.test(`${vendor} ${rendererName}`);
  const isMetal = /metal|apple m1|apple m2|apple m3|apple gpu/i.test(`${vendor} ${rendererName}`);
  return {
    vendor,
    renderer: rendererName,
    isMetal,
    isSwiftShader,
    hardwareAccepted: isMetal && !isSwiftShader,
  };
})();

const camera = new THREE.OrthographicCamera(-2.25, 2.25, 4.0, -4.0, 0.1, 100);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);

function resizeCamera() {
  const aspect = WIDTH / HEIGHT;
  const viewHeight = 8.2;
  const halfHeight = viewHeight * 0.5;
  const halfWidth = halfHeight * aspect;
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
}

resizeCamera();

const videoTexture = new THREE.VideoTexture(video);
videoTexture.colorSpace = THREE.SRGBColorSpace;
videoTexture.minFilter = THREE.LinearFilter;
videoTexture.magFilter = THREE.LinearFilter;
videoTexture.generateMipmaps = false;
const backgroundPlane = new THREE.Mesh(
  new THREE.PlaneGeometry((WIDTH / HEIGHT) * 8.2, 8.2),
  new THREE.MeshBasicMaterial({ map: videoTexture, depthWrite: false }),
);
backgroundPlane.position.z = -3;
scene.add(backgroundPlane);

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
    new THREE.MeshBasicMaterial({ color: 0x0e1018, transparent: true, opacity: 0.24, depthWrite: false }),
  );
}

const panel = makeRoundedPanel(4.65, 3.08, 0.20);
panel.position.set(0, -1.10, -0.32);
panel.rotation.y = -0.14;
panel.renderOrder = -1;
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

const typography = await createPlushTypography({ phrase, layout: 'overlay' });
typography.position.set(0, -0.72, 0);
typography.rotation.set(0.055, -0.28, 0);
scene.add(typography);

await RAPIER.init();
const physicsWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
const physicsState = {
  records: [],
  elapsed: 0,
  running: false,
  physicsSteps: 0,
  renderFrames: 0,
  slowRenderFrames: 0,
  lastFrameAt: performance.now(),
  lastRenderAt: -Infinity,
  accumulator: 0,
};

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
    ? new THREE.Vector3(side * (2.25 + (index % 5) * 0.19), ((index % 3) - 1) * 0.10, 0.18 + (index % 3) * 0.12)
    : new THREE.Vector3(side * (2.0 + (index % 5) * 0.19), -0.42 - (index % 3) * 0.20, 0.18 + (index % 3) * 0.12);
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
  physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(worldHalfExtents.x, worldHalfExtents.y, worldHalfExtents.z)
      .setFriction(0.72)
      .setRestitution(0.24),
    body,
  );
  body.setGravityScale(0, true);
  physicsState.records.push({
    id: node.name,
    character: node.userData.character,
    visual: node,
    parent,
    centerOffset,
    worldScale,
    body,
    targetPosition,
    targetQuaternion,
    startPosition,
    startQuaternion,
    phase: index * 1.61803398875,
    delay: 0.04 + (index % 15) * 0.035,
    softVariation: 0.88 + (index % 5) * 0.035,
    softHit: false,
  });
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

function triggerSoftLanding(record) {
  if (record.softHit) return;
  const direction = record.startPosition.x >= record.targetPosition.x ? 1 : -1;
  record.visual.userData.triggerSquash?.(0.36 * record.softVariation, direction);
  record.softHit = true;
}

function resetBodies() {
  physicsState.elapsed = 0;
  physicsState.physicsSteps = 0;
  physicsState.renderFrames = 0;
  physicsState.slowRenderFrames = 0;
  physicsState.accumulator = 0;
  physicsState.lastFrameAt = performance.now();
  physicsState.lastRenderAt = -Infinity;
  for (const record of physicsState.records) {
    record.body.setTranslation({ x: record.startPosition.x, y: record.startPosition.y, z: record.startPosition.z }, true);
    record.body.setRotation({ x: record.startQuaternion.x, y: record.startQuaternion.y, z: record.startQuaternion.z, w: record.startQuaternion.w }, true);
    record.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    record.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    record.body.wakeUp();
    record.visual.userData.resetSoftBody?.();
    record.softHit = false;
  }
  for (const record of physicsState.records) syncRecord(record);
}

function stepPhysics() {
  physicsState.elapsed += FIXED_STEP;
  for (const record of physicsState.records) {
    const localTime = physicsState.elapsed - record.delay;
    if (localTime <= 0) continue;
    const position = record.body.translation();
    const velocity = record.body.linvel();
    const impulse = new THREE.Vector3(
      record.targetPosition.x - position.x,
      record.targetPosition.y - position.y,
      record.targetPosition.z - position.z,
    ).multiplyScalar(10.5 * FIXED_STEP);
    impulse.x -= velocity.x * 3.1 * FIXED_STEP;
    impulse.y -= velocity.y * 3.1 * FIXED_STEP;
    impulse.z -= velocity.z * 3.1 * FIXED_STEP;
    record.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    const current = record.body.rotation();
    const currentQuaternion = new THREE.Quaternion(current.x, current.y, current.z, current.w);
    currentQuaternion.slerp(record.targetQuaternion, FIXED_STEP * 7.0);
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
  physicsWorld.timestep = FIXED_STEP;
  physicsWorld.step();
  physicsState.physicsSteps += 1;
  for (const record of physicsState.records) {
    syncRecord(record);
    record.visual.userData.updateSoftBody?.(FIXED_STEP, 0.006);
  }
}

function renderLoop(now) {
  const delta = Math.min((now - physicsState.lastFrameAt) / 1000, 0.1);
  physicsState.lastFrameAt = now;
  if (physicsState.running) {
    physicsState.accumulator += delta;
    while (physicsState.accumulator >= FIXED_STEP) {
      stepPhysics();
      physicsState.accumulator -= FIXED_STEP;
    }
    const renderDelta = now - physicsState.lastRenderAt;
    if (Number.isFinite(physicsState.lastRenderAt) && renderDelta > (1000 / FPS) * 1.5) {
      physicsState.slowRenderFrames += 1;
    }
  }
  const renderDue = !physicsState.running || (now - physicsState.lastRenderAt >= (1000 / FPS) - 0.25);
  if (renderDue) {
    physicsState.renderFrames += 1;
    physicsState.lastRenderAt = now;
    renderer.render(scene, camera);
  }
  requestAnimationFrame(renderLoop);
}

function waitForEvent(target, eventName) {
  return new Promise((resolve) => target.addEventListener(eventName, resolve, { once: true }));
}

function seekVideo(seconds) {
  if (Math.abs(video.currentTime - seconds) < 0.001) return Promise.resolve();
  return new Promise((resolve) => {
    video.addEventListener('seeked', resolve, { once: true });
    video.currentTime = seconds;
  });
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function chooseRecorderMime() {
  const options = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return options.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

const assetLoadStarted = performance.now();
const typographyReady = Promise.resolve();
if (video.readyState < 2) {
  video.load();
  await waitForEvent(video, 'loadeddata');
}
const assetLoadMs = performance.now() - assetLoadStarted;
const shaderWarmupStarted = performance.now();
await seekVideo(0);
for (let index = 0; index < 5; index += 1) {
  videoTexture.needsUpdate = true;
  renderer.render(scene, camera);
  await new Promise((resolve) => requestAnimationFrame(resolve));
}
const shaderWarmupMs = performance.now() - shaderWarmupStarted;
await typographyReady;

window.benchmarkReadyInfo = {
  gpu: gpuInfo,
  canvas: { width: renderer.domElement.width, height: renderer.domElement.height },
  video: { width: video.videoWidth, height: video.videoHeight, duration: video.duration },
  assetLoadMs,
  shaderWarmupMs,
  glyphCount: physicsState.records.length,
};
window.benchmarkReady = true;

window.benchmarkStartCapture = async ({ duration = 6 } = {}) => {
  resetBodies();
  physicsState.running = true;
  video.pause();
  await seekVideo(0);
  if (video.readyState >= 2) videoTexture.needsUpdate = true;
  await video.play();
  renderer.render(scene, camera);
  const stream = renderer.domElement.captureStream(FPS);
  const track = stream.getVideoTracks()[0];
  const mimeType = chooseRecorderMime();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 16_000_000 } : undefined);
  const chunks = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  const recorderStopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
  const captureStartedAt = performance.now();
  recorder.start(1000);
  await new Promise((resolve) => setTimeout(resolve, duration * 1000));
  recorder.stop();
  await recorderStopped;
  const captureElapsedMs = performance.now() - captureStartedAt;
  physicsState.running = false;
  video.pause();
  stream.getTracks().forEach((item) => item.stop());
  const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
  const dataUrl = await blobToDataUrl(blob);
  return {
    dataUrl,
    mimeType: mimeType || blob.type,
    blobBytes: blob.size,
    captureElapsedMs,
    renderFrames: physicsState.renderFrames,
    physicsSteps: physicsState.physicsSteps,
    slowRenderFrames: physicsState.slowRenderFrames,
    trackSettings: track.getSettings(),
    videoTime: video.currentTime,
  };
};

resetBodies();
requestAnimationFrame(renderLoop);
