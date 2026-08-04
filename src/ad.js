import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createPlushAlphabet } from './createPlushTypography.js';
import './ad.css';

const DURATION = 30;
const FIXED_STEP = 1 / 60;
const frame = document.querySelector('#ad-frame');
const stage = document.querySelector('#ad-stage');
const playButton = document.querySelector('#ad-play');
const restartButton = document.querySelector('#ad-restart');
const scrub = document.querySelector('#ad-scrub');
const status = document.querySelector('#ad-status');
const timecode = document.querySelector('#ad-timecode');
const topbar = document.querySelector('.ad-topbar');
const kicker = document.querySelector('#ad-kicker');
const headline = document.querySelector('#ad-headline');
const subline = document.querySelector('#ad-subline');
const flow = document.querySelector('#ad-flow');
const cta = document.querySelector('#ad-cta');
const proofStates = {
  input: document.querySelector('#ad-input-state'),
  draft: document.querySelector('#ad-draft-state'),
  edit: document.querySelector('#ad-edit-state'),
};

const scene = new THREE.Scene();
scene.background = new THREE.Color('#f7f4ef');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(stage.clientWidth, stage.clientHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const camera = new THREE.OrthographicCamera(-2.7, 2.7, 4.8, -4.8, 0.1, 100);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);

function resize() {
  const aspect = Math.max(0.35, stage.clientWidth / Math.max(1, stage.clientHeight));
  const viewHeight = 9.6;
  const halfHeight = viewHeight * 0.5;
  const halfWidth = halfHeight * aspect;
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(stage.clientWidth, stage.clientHeight, false);
}

resize();
window.addEventListener('resize', resize);

scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa8bc, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 4.0);
key.position.set(-3.5, 5.0, 7.0);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
scene.add(key);
const fill = new THREE.DirectionalLight(0x8db8ff, 2.1);
fill.position.set(4.4, 1.2, 3.2);
scene.add(fill);
const warm = new THREE.PointLight(0xffc857, 7.0, 9.0, 2);
warm.position.set(-2.5, -0.6, 1.5);
scene.add(warm);

const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(12, 12),
  new THREE.MeshPhysicalMaterial({ color: '#eaf2ff', roughness: 0.94, metalness: 0 }),
);
backdrop.position.z = -1.25;
scene.add(backdrop);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(12, 5.5),
  new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.98, metalness: 0 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, -3.35, 0.1);
floor.receiveShadow = true;
scene.add(floor);

const softPanel = new THREE.Mesh(
  new THREE.PlaneGeometry(4.9, 2.25),
  new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.9, transparent: true, opacity: 0.62 }),
);
softPanel.position.set(0.48, -0.18, -0.66);
scene.add(softPanel);

function getGlyphs(group) {
  const glyphs = [];
  group.traverse((node) => {
    if (node.name.startsWith('glyph.') && node.userData?.physics) glyphs.push(node);
  });
  return glyphs;
}

function makeWordState(group, target, color, entryDirection = 1) {
  const glyphs = getGlyphs(group);
  group.userData.setAllColor?.(color);
  group.position.set(target.x + entryDirection * 1.25, target.y - 0.15, target.z);
  group.rotation.set(0, entryDirection * 0.08, entryDirection * 0.05);
  group.scale.setScalar(0.88);
  glyphs.forEach((glyph, index) => {
    glyph.userData.setSoftness?.(0.80 - (index % 3) * 0.06);
    glyph.userData._adTarget = glyph.position.clone();
    glyph.userData._adEntryPosition = glyph.position.clone().add(new THREE.Vector3(0, -0.28 - (index % 3) * 0.07, 0.14));
    glyph.userData._adEntryRotation = glyph.rotation.clone();
    glyph.userData._adTargetRotation = glyph.rotation.clone();
    glyph.visible = false;
  });
  group.visible = false;
  return { group, glyphs, target: new THREE.Vector3(target.x, target.y, target.z), color, entered: false, entryDirection };
}

function smoothStep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function updateWordState(word, localTime, duration = 0.8) {
  if (localTime < -0.02) {
    word.group.visible = false;
    return;
  }
  word.group.visible = true;
  const progress = smoothStep(Math.min(1, Math.max(0, localTime / duration)));
  word.group.position.lerpVectors(
    new THREE.Vector3(word.target.x + word.entryDirection * 1.25, word.target.y - 0.15, word.target.z),
    word.target,
    progress,
  );
  word.group.scale.setScalar(0.88 + progress * 0.12);
  word.group.rotation.y = word.entryDirection * 0.08 * (1 - progress);
  word.group.rotation.z = word.entryDirection * 0.05 * (1 - progress);
  for (const [index, glyph] of word.glyphs.entries()) {
    const target = glyph.userData._adTarget;
    const entry = glyph.userData._adEntryPosition;
    glyph.visible = true;
    glyph.position.lerpVectors(entry, target, progress);
    const wobble = Math.sin(Math.max(0, localTime) * 13 + index * 0.72) * 0.025 * (1 - progress);
    glyph.rotation.set(
      glyph.userData._adTargetRotation.x + wobble,
      glyph.userData._adTargetRotation.y,
      glyph.userData._adTargetRotation.z + wobble * 0.8,
    );
    if (progress > 0.80 && !word.entered) glyph.userData.triggerSquash?.(0.34 + (index % 3) * 0.04, word.entryDirection);
    glyph.userData.updateSoftBody?.(1 / 60, 0.002 * (1 - progress));
  }
  if (progress > 0.80) word.entered = true;
}

const hookGroup = await createPlushAlphabet({
  characters: 'TEACHERS',
  preserveDuplicates: true,
  size: 0.68,
  editableColor: true,
  textureSize: 384,
  curveSegments: 24,
  bevelSegments: 10,
  columns: 9,
  rowGap: 0.8,
});
hookGroup.position.set(0, 1.62, 0.32);
scene.add(hookGroup);
const hookGlyphs = getGlyphs(hookGroup);

const inputWord = await createPlushAlphabet({ characters: 'INPUT', size: 0.54, editableColor: true, textureSize: 384, curveSegments: 24, bevelSegments: 10, columns: 5 });
const draftWord = await createPlushAlphabet({ characters: 'DRAFT', size: 0.54, editableColor: true, textureSize: 384, curveSegments: 24, bevelSegments: 10, columns: 5 });
const editWord = await createPlushAlphabet({ characters: 'EDIT', size: 0.54, editableColor: true, textureSize: 384, curveSegments: 24, bevelSegments: 10, columns: 4 });
const words = {
  input: makeWordState(inputWord, { x: -0.82, y: 1.70, z: 0.45 }, '#2f6bff', -1),
  draft: makeWordState(draftWord, { x: -0.78, y: 1.70, z: 0.45 }, '#ffc857', -1),
  edit: makeWordState(editWord, { x: -0.68, y: 1.70, z: 0.45 }, '#ff6b6b', -1),
};
Object.values(words).forEach(({ group }) => scene.add(group));

await RAPIER.init();
const physicsWorld = new RAPIER.World({ x: 0, y: -7.5, z: 0 });
const physicsEvents = new RAPIER.EventQueue(true);
const hookPhysics = [];
hookGroup.updateMatrixWorld(true);
const hookFloor = physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, hookGroup.position.y - 0.62, 0.28));
physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(3.2, 0.08, 0.8).setFriction(0.84).setRestitution(0.18), hookFloor);

for (const [index, glyph] of hookGlyphs.entries()) {
  const physicsData = glyph.userData.physics;
  const centerOffset = new THREE.Vector3(...physicsData.centerOffset);
  const target = glyph.localToWorld(centerOffset.clone());
  const start = target.clone().add(new THREE.Vector3(((index % 5) - 2) * 0.30, 2.65 + (index % 4) * 0.34, 0.12 + (index % 3) * 0.05));
  const body = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start.x, start.y, start.z)
      .setAdditionalMass(Math.max(0.4, physicsData.mass))
      .setLinearDamping(0.34)
      .setAngularDamping(0.44)
      .setCanSleep(false),
  );
  body.setGravityScale(1, true);
  const collider = physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(physicsData.halfExtents[0], physicsData.halfExtents[1], physicsData.halfExtents[2])
      .setFriction(0.82)
      .setRestitution(0.24),
    body,
  );
  hookPhysics.push({ glyph, body, collider, target, start, centerOffset, landed: false, phase: index * 0.23 });
  glyph.visible = true;
}

function syncHookGlyph(record) {
  const translation = record.body.translation();
  const rotation = record.body.rotation();
  const bodyQuaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  const scaledOffset = record.centerOffset.clone().applyQuaternion(bodyQuaternion);
  const worldPosition = new THREE.Vector3(translation.x, translation.y, translation.z).sub(scaledOffset);
  record.glyph.position.copy(record.glyph.parent.worldToLocal(worldPosition));
  record.glyph.quaternion.copy(bodyQuaternion);
  record.glyph.userData.setSoftBaseQuaternion?.(record.glyph.quaternion);
}

function resetHookPhysics() {
  for (const record of hookPhysics) {
    record.body.setTranslation({ x: record.start.x, y: record.start.y, z: record.start.z }, true);
    record.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    record.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    record.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    record.body.setGravityScale(1, true);
    record.body.wakeUp();
    record.landed = false;
    record.glyph.userData.resetSoftBody?.();
    record.glyph.visible = true;
  }
}

function stepHookPhysics(seconds, delta) {
  if (seconds >= 3.0) return;
  for (const record of hookPhysics) {
    if (seconds > 2.0) {
      record.body.setGravityScale(0, true);
      const position = record.body.translation();
      const dx = record.target.x - position.x;
      const dy = record.target.y - position.y;
      const dz = record.target.z - position.z;
      record.body.setLinvel({ x: dx * 7.2, y: dy * 7.2, z: dz * 7.2 }, true);
      if (!record.landed && Math.hypot(dx, dy, dz) < 0.08) {
        record.body.setTranslation({ x: record.target.x, y: record.target.y, z: record.target.z }, true);
        record.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        record.glyph.userData.triggerSquash?.(0.40, indexDirection(record));
        record.landed = true;
      }
    }
  }
  const substeps = Math.max(1, Math.min(4, Math.ceil(delta / FIXED_STEP)));
  for (let index = 0; index < substeps; index += 1) physicsWorld.step(physicsEvents);
  physicsEvents.drainCollisionEvents(() => {});
  hookPhysics.forEach(syncHookGlyph);
}

function indexDirection(record) {
  return record.target.x > 0 ? -1 : 1;
}

let elapsed = 0;
let playing = true;
let lastTime = performance.now();
let accumulator = 0;

function setStateVisible(state, isVisible) {
  proofStates[state]?.classList.toggle('is-visible', isVisible);
}

function updateText(seconds) {
  if (seconds < 3) {
    headline.textContent = 'Teachers.';
    subline.textContent = ' ';
  } else if (seconds < 6) {
    headline.textContent = 'Planning your next lesson?';
    subline.textContent = 'Start with the idea, not a blank page.';
  } else if (seconds < 10) {
    headline.textContent = 'Start with the idea.';
    subline.textContent = 'A clear input for your next Lesson Plan.';
  } else if (seconds < 16) {
    headline.textContent = 'See the structure.';
    subline.textContent = 'A draft you can actually work with.';
  } else if (seconds < 21) {
    headline.textContent = 'Make it yours.';
    subline.textContent = 'Edit the draft for your classroom.';
  } else if (seconds < 27) {
    headline.textContent = 'Your idea → your draft';
    subline.textContent = 'You stay in control.';
  } else {
    headline.textContent = 'You stay in control.';
    subline.textContent = 'Try Aidemia today.';
  }
  const visible = seconds > 2.7;
  topbar.classList.toggle('is-hidden', seconds < 3);
  kicker.classList.toggle('is-visible', seconds >= 5.6);
  headline.classList.toggle('is-visible', visible || seconds < 3);
  subline.classList.toggle('is-visible', seconds > 3.1);
  flow.classList.toggle('is-visible', seconds >= 21 && seconds < 27);
  cta.classList.toggle('is-visible', seconds >= 26.8);
  setStateVisible('input', seconds >= 6 && seconds < 10.8);
  setStateVisible('draft', seconds >= 10 && seconds < 18.3);
  setStateVisible('edit', seconds >= 16 && seconds < 23.7);
}

function updateVisuals(seconds, delta) {
  const hookVisible = seconds < 6.3;
  hookGroup.visible = hookVisible;
  if (hookVisible) {
    accumulator += delta;
    while (accumulator >= FIXED_STEP) {
      stepHookPhysics(seconds, FIXED_STEP);
      accumulator -= FIXED_STEP;
    }
    hookGlyphs.forEach((glyph) => glyph.userData.updateSoftBody?.(Math.min(delta, 0.033), 0.002));
    if (seconds >= 3.1) {
      hookGroup.rotation.z = Math.sin(seconds * 1.8) * 0.012;
      hookGroup.position.y = 1.62 + Math.sin(seconds * 2.1) * 0.025;
    }
  }
  updateWordState(words.input, seconds - 6.0, 0.72);
  updateWordState(words.draft, seconds - 10.0, 0.78);
  updateWordState(words.edit, seconds - 16.0, 0.74);
  words.input.group.visible = seconds >= 6.0 && seconds < 10.8;
  words.draft.group.visible = seconds >= 10.0 && seconds < 18.3;
  words.edit.group.visible = seconds >= 16.0 && seconds < 23.7;
  const activeWord = seconds < 10.5 ? words.input : seconds < 16.4 ? words.draft : words.edit;
  Object.values(words).forEach((word) => {
    if (word !== activeWord && seconds > 23.8) word.group.visible = false;
  });
}

function formatTime(seconds) {
  const whole = Math.max(0, Math.min(DURATION, Math.floor(seconds)));
  return `00:${String(whole).padStart(2, '0')} / 00:30`;
}

function render() {
  renderer.render(scene, camera);
}

function reset() {
  elapsed = 0;
  accumulator = 0;
  playing = true;
  lastTime = performance.now();
  resetHookPhysics();
  Object.values(words).forEach((word) => {
    word.entered = false;
    word.group.visible = false;
    word.glyphs.forEach((glyph) => glyph.userData.resetSoftBody?.());
  });
  playButton.textContent = 'Pause';
  status.textContent = 'Live preview · 30 seconds';
  scrub.value = '0';
}

function update(delta) {
  if (!playing) return;
  elapsed = Math.min(DURATION, elapsed + delta);
  if (elapsed >= DURATION) {
    elapsed = DURATION;
    playing = false;
    playButton.textContent = 'Play';
    status.textContent = 'Preview complete · Replay';
  }
  updateText(elapsed);
  updateVisuals(elapsed, delta);
  timecode.textContent = formatTime(elapsed);
  scrub.value = String(elapsed);
}

function animate(now) {
  const delta = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  update(delta);
  render();
  requestAnimationFrame(animate);
}

playButton.addEventListener('click', () => {
  if (elapsed >= DURATION) elapsed = 0;
  playing = !playing;
  playButton.textContent = playing ? 'Pause' : 'Play';
  status.textContent = playing ? 'Live preview · 30 seconds' : 'Paused · scrub or play';
  lastTime = performance.now();
});

restartButton.addEventListener('click', reset);
scrub.addEventListener('input', () => {
  elapsed = Number(scrub.value);
  playing = false;
  playButton.textContent = 'Play';
  status.textContent = 'Paused · scrub or play';
  updateText(elapsed);
  updateVisuals(elapsed, 0);
  timecode.textContent = formatTime(elapsed);
  render();
});

window.adPreview = {
  play: () => { playing = true; lastTime = performance.now(); },
  pause: () => { playing = false; },
  reset,
  seek(seconds) {
    elapsed = Math.max(0, Math.min(DURATION, Number(seconds) || 0));
    updateText(elapsed);
    updateVisuals(elapsed, 0);
    timecode.textContent = formatTime(elapsed);
    scrub.value = String(elapsed);
    render();
  },
  duration: DURATION,
  timeline: 'TEACHERS → INPUT → DRAFT → EDIT → CTA',
};

updateText(0);
reset();
requestAnimationFrame(animate);
