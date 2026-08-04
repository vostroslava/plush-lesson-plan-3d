import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { createPlushAlphabet } from './createPlushTypography.js';
import './alphabet.css';

const app = document.querySelector('#alphabet-app');
const query = new URLSearchParams(window.location.search);
const pageKey = query.get('page') ?? 'letters';
const pageConfigs = {
  letters: { label: 'Letters A–Z', characters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', columns: 8, rowGap: 0.88, size: 0.70, cameraZ: 9.35 },
  numbers: { label: 'Numbers 0–9', characters: '0123456789', columns: 5, rowGap: 1.05, size: 0.94, cameraZ: 8.20 },
  symbols: { label: 'Production signs', characters: '.,!?;:()[]{}+-=/%&@#*', columns: 7, rowGap: 0.92, size: 0.78, cameraZ: 8.85 },
};
const pageConfig = pageConfigs[pageKey] ?? pageConfigs.letters;
document.querySelector('.alphabet-ui h1').innerHTML = `${pageConfig.label}.<br />One tactile system.`;
for (const link of document.querySelectorAll('[data-page]')) {
  link.classList.toggle('active', link.dataset.page === (pageConfigs[pageKey] ? pageKey : 'letters'));
}
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0910);

const camera = new THREE.PerspectiveCamera(31, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0.82, -0.05, pageConfig.cameraZ);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
app.appendChild(renderer.domElement);

const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(7.2, 5.8),
  new THREE.MeshPhysicalMaterial({
    color: 0x261833,
    roughness: 0.92,
    metalness: 0,
    clearcoat: 0.08,
  }),
);
backdrop.position.set(1.20, 0.12, -0.58);
backdrop.receiveShadow = false;
scene.add(backdrop);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(14, 8),
  new THREE.MeshPhysicalMaterial({ color: 0x120d18, roughness: 0.94, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -2.30, 0);
ground.receiveShadow = true;
scene.add(ground);

scene.add(new THREE.HemisphereLight(0xffe4d3, 0x1b1026, 1.8));
const key = new THREE.DirectionalLight(0xffd6c1, 3.5);
key.position.set(-3.6, 5.2, 6.0);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -5;
key.shadow.camera.right = 5;
key.shadow.camera.top = 5;
key.shadow.camera.bottom = -5;
scene.add(key);
const fill = new THREE.DirectionalLight(0x8ebdff, 2.0);
fill.position.set(4.2, 1.0, 3.0);
scene.add(fill);
const rim = new THREE.PointLight(0xff5bbf, 18, 8, 2);
rim.position.set(-2.4, 1.4, -1.4);
scene.add(rim);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 6.5;
controls.maxDistance = 12.5;
controls.target.set(0.82, -0.08, 0);

const alphabet = await createPlushAlphabet({
  characters: pageConfig.characters,
  size: pageConfig.size,
  editableColor: true,
  textureSize: 512,
  curveSegments: 28,
  bevelSegments: 12,
  columns: pageConfig.columns,
  rowGap: pageConfig.rowGap,
});
alphabet.position.set(1.20, 0.02, 0);
scene.add(alphabet);

await RAPIER.init();
const physicsWorld = new RAPIER.World({ x: 0, y: -5.5, z: 0 });
const physicsEvents = new RAPIER.EventQueue(true);
const colliderRecords = new Map();
const groundBody = physicsWorld.createRigidBody(
  RAPIER.RigidBodyDesc.fixed().setTranslation(0, ground.position.y - 0.08, 0),
);
physicsWorld.createCollider(
  RAPIER.ColliderDesc.cuboid(7, 0.08, 4)
    .setFriction(0.92)
    .setRestitution(0.10)
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
  groundBody,
);

const physicsState = {
  active: false,
  records: [],
  wind: false,
  time: 0,
  impactWave: 0,
  showcase: null,
};

const assemblyState = {
  active: false,
  completed: false,
  elapsed: 0,
  duration: 1.65,
  records: [],
  clones: [],
};

function makeCollider(record) {
  const physicsData = record.visual.userData.physics;
  const worldScale = record.visual.getWorldScale(new THREE.Vector3());
  const halfExtents = new THREE.Vector3(
    physicsData.halfExtents[0] * worldScale.x,
    physicsData.halfExtents[1] * worldScale.y,
    physicsData.halfExtents[2] * worldScale.z,
  );
  return physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setFriction(physicsData.friction)
      .setRestitution(physicsData.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    record.body,
  );
}

function syncRecord(record) {
  const translation = record.body.translation();
  const rotation = record.body.rotation();
  const bodyQuaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  const worldScale = record.visual.getWorldScale(new THREE.Vector3());
  const scaledOffset = record.centerOffset.clone().multiply(worldScale).applyQuaternion(bodyQuaternion);
  const worldPosition = new THREE.Vector3(translation.x, translation.y, translation.z).sub(scaledOffset);
  record.visual.position.copy(record.parent.worldToLocal(worldPosition));
  const parentQuaternion = record.parent.getWorldQuaternion(new THREE.Quaternion());
  const localQuaternion = parentQuaternion.invert().multiply(bodyQuaternion);
  record.visual.quaternion.copy(localQuaternion);
  record.visual.userData.setSoftBaseQuaternion?.(localQuaternion);
}

function refreshInitialPose(record) {
  alphabet.updateMatrixWorld(true);
  const worldScale = record.visual.getWorldScale(new THREE.Vector3());
  const scaledOffset = record.centerOffset.clone().multiply(worldScale);
  const bodyCenter = record.visual.localToWorld(scaledOffset);
  const worldQuaternion = record.visual.getWorldQuaternion(new THREE.Quaternion());
  record.initial = {
    translation: { x: bodyCenter.x, y: bodyCenter.y, z: bodyCenter.z },
    rotation: { x: worldQuaternion.x, y: worldQuaternion.y, z: worldQuaternion.z, w: worldQuaternion.w },
  };
}

function refreshCollider(record) {
  if (record.collider) {
    colliderRecords.delete(record.collider.handle);
    physicsWorld.removeCollider(record.collider, true);
  }
  record.collider = makeCollider(record);
  colliderRecords.set(record.collider.handle, record);
}

alphabet.updateMatrixWorld(true);
alphabet.traverse((node) => {
  if (!node.name.startsWith('glyph.') || !node.userData?.physics) return;
  const physicsData = node.userData.physics;
  const parent = node.parent;
  const centerOffset = new THREE.Vector3(...physicsData.centerOffset);
  const worldScale = node.getWorldScale(new THREE.Vector3());
  const bodyCenter = node.localToWorld(centerOffset.clone().multiply(worldScale));
  const worldQuaternion = node.getWorldQuaternion(new THREE.Quaternion());
  const body = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(bodyCenter.x, bodyCenter.y, bodyCenter.z)
      .setRotation({ x: worldQuaternion.x, y: worldQuaternion.y, z: worldQuaternion.z, w: worldQuaternion.w })
      .setAdditionalMass(physicsData.mass)
      .setLinearDamping(physicsData.linearDamping ?? 3.8)
      .setAngularDamping(physicsData.angularDamping ?? 4.2)
      .setCanSleep(true),
  );
  body.setGravityScale(0, true);
  const record = {
    id: node.name,
    character: node.userData.character,
    visual: node,
    parent,
    centerOffset,
    body,
    collider: null,
    initial: null,
    targetPosition: node.position.clone(),
    targetQuaternion: node.quaternion.clone(),
    lastSpeed: 0,
    lastAngularSpeed: 0,
    impactCooldown: 0,
    softVariation: 0.86 + ((physicsState.records.length * 37) % 19) / 100,
  };
  record.collider = makeCollider(record);
  colliderRecords.set(record.collider.handle, record);
  record.initial = {
    translation: { x: bodyCenter.x, y: bodyCenter.y, z: bodyCenter.z },
    rotation: { x: worldQuaternion.x, y: worldQuaternion.y, z: worldQuaternion.z, w: worldQuaternion.w },
  };
  node.userData.physicsBodyId = record.id;
  node.userData.physicsBody = body;
  node.traverse((child) => {
    if (child.isMesh) child.userData.glyphRoot = node;
  });
  physicsState.records.push(record);
});

function setAssemblyPose(record, worldPosition, worldQuaternion) {
  record.visual.position.copy(record.parent.worldToLocal(worldPosition.clone()));
  const parentQuaternion = record.parent.getWorldQuaternion(new THREE.Quaternion());
  const localQuaternion = parentQuaternion.invert().multiply(worldQuaternion);
  record.visual.quaternion.copy(localQuaternion);
  if (!record.isVisualClone) record.visual.userData.setSoftBaseQuaternion?.(localQuaternion);
}

function clearWordAssembly() {
  for (const clone of assemblyState.clones) clone.parent?.remove(clone);
  assemblyState.active = false;
  assemblyState.completed = false;
  assemblyState.elapsed = 0;
  assemblyState.records = [];
  assemblyState.clones = [];
  for (const record of physicsState.records) {
    record.visual.visible = true;
    record.assemblyImpact = false;
    record.assemblyStart = null;
    record.assemblyTarget = null;
    record.assemblyStartQuaternion = null;
    record.assemblyTargetQuaternion = null;
  }
}

function cloneGlyphVisualNode(sourceNode) {
  let clone;
  if (sourceNode.isInstancedMesh) {
    clone = new THREE.InstancedMesh(sourceNode.geometry, sourceNode.material, sourceNode.count);
    clone.instanceMatrix.copy(sourceNode.instanceMatrix);
    clone.instanceMatrix.needsUpdate = true;
    if (sourceNode.instanceColor) clone.instanceColor = sourceNode.instanceColor.clone();
  } else if (sourceNode.isMesh) {
    clone = new THREE.Mesh(sourceNode.geometry, sourceNode.material);
  } else if (sourceNode.isLineSegments) {
    clone = new THREE.LineSegments(sourceNode.geometry, sourceNode.material);
  } else if (sourceNode.isLine) {
    clone = new THREE.Line(sourceNode.geometry, sourceNode.material);
  } else if (sourceNode.isPoints) {
    clone = new THREE.Points(sourceNode.geometry, sourceNode.material);
  } else {
    clone = new THREE.Group();
  }
  clone.name = sourceNode.name;
  clone.position.copy(sourceNode.position);
  clone.quaternion.copy(sourceNode.quaternion);
  clone.scale.copy(sourceNode.scale);
  clone.visible = sourceNode.visible;
  clone.renderOrder = sourceNode.renderOrder;
  clone.castShadow = sourceNode.castShadow;
  clone.receiveShadow = sourceNode.receiveShadow;
  for (const child of sourceNode.children) clone.add(cloneGlyphVisualNode(child));
  return clone;
}

function createAssemblyClone(sourceRecord, occurrence) {
  const source = sourceRecord.visual;
  const clone = cloneGlyphVisualNode(source);
  clone.name = `${source.name}.assembly-copy.${occurrence}`;
  clone.userData = {
    character: sourceRecord.character,
    assemblyClone: true,
  };
  const sourceWorldPosition = source.getWorldPosition(new THREE.Vector3());
  const sourceWorldQuaternion = source.getWorldQuaternion(new THREE.Quaternion());
  const sourceWorldScale = source.getWorldScale(new THREE.Vector3());
  clone.position.copy(alphabet.worldToLocal(sourceWorldPosition));
  clone.quaternion.copy(alphabet.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(sourceWorldQuaternion));
  clone.scale.copy(sourceWorldScale);
  clone.traverse((child) => {
    child.userData = { ...child.userData, glyphRoot: clone };
  });
  alphabet.add(clone);
  const cloneRecord = {
    ...sourceRecord,
    id: clone.name,
    visual: clone,
    parent: alphabet,
    isVisualClone: true,
    sourceRecord,
    assemblyImpact: false,
  };
  assemblyState.clones.push(clone);
  return cloneRecord;
}

function assembleWord(text = 'TEACHERS') {
  resetPhysics();
  const requested = [...String(text ?? '').toUpperCase()].filter((character) => /[A-Z0-9.,!?;:()[\]{}+\-=/%&@#*]/.test(character));
  const available = new Map(physicsState.records.map((record) => [record.character, record]));
  const selected = [];
  const occurrences = new Map();
  for (const character of requested) {
    const record = available.get(character);
    if (!record) continue;
    const occurrence = occurrences.get(character) ?? 0;
    selected.push(occurrence === 0 ? record : createAssemblyClone(record, occurrence));
    occurrences.set(character, occurrence + 1);
  }
  if (selected.length === 0) {
    status.textContent = `No glyphs from “${String(text || '').toUpperCase()}” on this page`;
    return false;
  }

  alphabet.updateMatrixWorld(true);
  const widths = selected.map((record) => {
    const bounds = new THREE.Box3().setFromObject(record.visual);
    return Math.max(0.26, bounds.getSize(new THREE.Vector3()).x);
  });
  const gap = pageKey === 'letters' ? 0.06 : 0.08;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, selected.length - 1);
  const assemblyCenter = new THREE.Vector3(1.20, 0.04, 0.22);
  const assemblyQuaternion = alphabet.getWorldQuaternion(new THREE.Quaternion());
  let cursor = assemblyCenter.x - totalWidth * 0.5;
  selected.forEach((record, index) => {
    record.assemblyStart = record.visual.getWorldPosition(new THREE.Vector3());
    record.assemblyStartQuaternion = record.visual.getWorldQuaternion(new THREE.Quaternion());
    record.assemblyTarget = new THREE.Vector3(
      cursor + widths[index] * 0.5,
      assemblyCenter.y,
      assemblyCenter.z,
    );
    record.assemblyTargetQuaternion = assemblyQuaternion.clone();
    record.assemblyImpact = false;
    cursor += widths[index] + gap;
    record.visual.visible = true;
    record.visual.userData.resetSoftBody?.();
  });
  const selectedSources = new Set(selected.map((record) => record.sourceRecord ?? record));
  for (const record of physicsState.records) {
    if (!selectedSources.has(record)) record.visual.visible = false;
  }
  assemblyState.active = true;
  assemblyState.completed = false;
  assemblyState.elapsed = 0;
  assemblyState.duration = Math.min(2.25, Math.max(1.15, 1.15 + selected.length * 0.075));
  assemblyState.records = selected;
  status.textContent = `Magnetic assembly · ${selected.map((record) => record.character).join('')} · flying into place`;
  return true;
}

function updateWordAssembly(delta) {
  if (!assemblyState.active) return;
  assemblyState.elapsed += delta;
  const stagger = Math.min(0.34, assemblyState.duration * 0.20);
  for (const [index, record] of assemblyState.records.entries()) {
    const localTime = assemblyState.elapsed - index * stagger / Math.max(1, assemblyState.records.length - 1);
    const progress = THREE.MathUtils.clamp(localTime / assemblyState.duration, 0, 1);
    const eased = progress < 1 ? progress * progress * (3 - 2 * progress) : 1;
    const worldPosition = record.assemblyStart.clone().lerp(record.assemblyTarget, eased);
    worldPosition.y += Math.sin(Math.PI * eased) * (0.18 + (index % 3) * 0.035);
    worldPosition.z += Math.sin(Math.PI * eased) * (0.12 + (index % 2) * 0.025);
    const worldQuaternion = record.assemblyStartQuaternion.clone().slerp(record.assemblyTargetQuaternion, eased);
    setAssemblyPose(record, worldPosition, worldQuaternion);
    if (progress > 0.82 && !record.assemblyImpact) {
      triggerSoftImpact(record, 0.34 + (index % 3) * 0.04, index % 2 === 0 ? 1 : -1);
      record.assemblyImpact = true;
    }
  }
  if (assemblyState.elapsed > assemblyState.duration + 0.46) {
    assemblyState.active = false;
    assemblyState.completed = true;
    status.textContent = `Magnetic assembly · ${assemblyState.records.map((record) => record.character).join('')} ready`;
  }
}

function resetPhysics() {
  physicsState.active = false;
  physicsState.impactWave = 0;
  physicsState.showcase = null;
  clearWordAssembly();
  ground.visible = true;
  alphabet.updateMatrixWorld(true);
  for (const record of physicsState.records) {
    record.visual.position.copy(record.targetPosition);
    record.visual.quaternion.copy(record.targetQuaternion);
    record.visual.userData.setSoftBaseQuaternion?.(record.targetQuaternion);
    record.visual.userData.resetSoftBody?.();
    refreshInitialPose(record);
    record.body.setGravityScale(0, true);
    record.body.setTranslation(record.initial.translation, true);
    record.body.setRotation(record.initial.rotation, true);
    record.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    record.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    record.body.wakeUp();
    syncRecord(record);
    record.lastSpeed = 0;
    record.lastAngularSpeed = 0;
    record.impactCooldown = 0;
  }
  status.textContent = `${alphabet.userData.letters.length} glyphs · hero detail · individual physics`;
}

function triggerSoftImpact(record, strength = 0.5, direction = 1) {
  const amount = Math.max(0.05, Math.min(1.25, Number(strength) || 0));
  record.visual.userData.triggerSquash?.(amount * record.softVariation, direction);
  record.impactCooldown = Math.max(record.impactCooldown, 0.10);
}

function triggerImpactWave(sourceRecord, strength = 0.75) {
  const origin = sourceRecord?.visual.position.clone() ?? new THREE.Vector3(0, 0, 0);
  const waveStrength = Math.max(0.1, Math.min(1.2, Number(strength) || 0));
  physicsState.impactWave = Math.max(physicsState.impactWave, waveStrength);
  for (const record of physicsState.records) {
    const distance = origin.distanceTo(record.visual.position);
    const neighborFactor = sourceRecord === record ? 1 : Math.max(0.12, 1 - distance / 3.4);
    triggerSoftImpact(record, waveStrength * neighborFactor, record.visual.position.x >= origin.x ? 1 : -1);
  }
}

function handleCollisionEvents() {
  physicsEvents.drainCollisionEvents((handleA, handleB, started) => {
    if (!started) return;
    const recordA = colliderRecords.get(handleA);
    const recordB = colliderRecords.get(handleB);
    if (!recordA && !recordB) return;
    const speedA = recordA ? Math.hypot(recordA.body.linvel().x, recordA.body.linvel().y, recordA.body.linvel().z) : 0;
    const speedB = recordB ? Math.hypot(recordB.body.linvel().x, recordB.body.linvel().y, recordB.body.linvel().z) : 0;
    const impact = Math.max(0.18, Math.min(1.1, (speedA + speedB) * 0.18));
    if (recordA) triggerSoftImpact(recordA, impact, -1);
    if (recordB) triggerSoftImpact(recordB, impact, 1);
    if (recordA && recordB) {
      triggerSoftImpact(recordA, impact * 0.42, recordA.visual.position.x >= recordB.visual.position.x ? 1 : -1);
      triggerSoftImpact(recordB, impact * 0.42, recordB.visual.position.x >= recordA.visual.position.x ? 1 : -1);
    }
  });
}

function updateSoftBodies(delta) {
  physicsState.time += delta;
  if (physicsState.showcase) {
    physicsState.showcase.elapsed += delta;
    if (physicsState.showcase.index < physicsState.records.length && physicsState.showcase.elapsed >= physicsState.showcase.nextAt) {
      const record = physicsState.records[physicsState.showcase.index];
      triggerImpactWave(record, 0.64);
      physicsState.showcase.index += 1;
      physicsState.showcase.nextAt += 0.17;
    }
    if (physicsState.showcase.index >= physicsState.records.length && physicsState.showcase.elapsed > 2.8) {
      physicsState.showcase = null;
      physicsState.wind = false;
      const windButton = document.querySelector('#wind-toggle');
      if (windButton) windButton.textContent = 'Breeze on';
    }
  }
  for (const record of physicsState.records) {
    const linear = record.body.linvel();
    const angular = record.body.angvel();
    const speed = Math.hypot(linear.x, linear.y, linear.z);
    const angularSpeed = Math.hypot(angular.x, angular.y, angular.z);
    const speedJump = speed - record.lastSpeed;
    if (physicsState.active && record.impactCooldown <= 0 && (speedJump > 0.18 || angularSpeed - record.lastAngularSpeed > 0.28)) {
      triggerSoftImpact(record, Math.min(0.85, 0.22 + Math.max(speedJump, angularSpeed * 0.12)), linear.x >= 0 ? 1 : -1);
    }
    record.lastSpeed = speed;
    record.lastAngularSpeed = angularSpeed;
    record.impactCooldown = Math.max(0, record.impactCooldown - delta);
    const wind = physicsState.wind
      ? 0.048 + Math.sin(physicsState.time * 1.25 + record.id.length) * 0.012
      : 0;
    record.visual.userData.updateSoftBody?.(delta, wind);
  }
  physicsState.impactWave *= Math.exp(-delta * 5.5);
}

function startPhysics() {
  if (assemblyState.active || assemblyState.completed) resetPhysics();
  if (physicsState.active) return;
  physicsState.active = true;
  for (const [index, record] of physicsState.records.entries()) {
    const phase = index * 1.61803398875;
    record.body.setGravityScale(1, true);
    record.body.wakeUp();
    record.body.applyImpulse({
      x: Math.sin(phase) * 0.045,
      y: 0.05 + (index % 3) * 0.018,
      z: Math.cos(phase) * 0.12,
    }, true);
    record.body.applyTorqueImpulse({
      x: Math.cos(phase * 0.7) * 0.024,
      y: Math.sin(phase * 0.9) * 0.018,
      z: Math.cos(phase * 1.3) * 0.024,
    }, true);
    triggerSoftImpact(record, 0.18 + (index % 4) * 0.035, index % 2 === 0 ? 1 : -1);
  }
}

function impulseGlyph(id, impulse = { x: 0.18, y: 0.34, z: 0.42 }) {
  if (!physicsState.active) startPhysics();
  const record = physicsState.records.find((item) => item.id === id);
  if (!record) return false;
  record.body.wakeUp();
  record.body.applyImpulse(impulse, true);
  record.body.applyTorqueImpulse({ x: impulse.z * 0.16, y: impulse.x * -0.12, z: impulse.y * 0.10 }, true);
  triggerImpactWave(record, Math.min(1.05, Math.hypot(impulse.x, impulse.y, impulse.z) * 1.25));
  return true;
}

function refreshStylePhysics(letter) {
  const record = physicsState.records.find((item) => item.character === String(letter).toUpperCase());
  if (!record) return;
  record.visual.userData.resetSoftBody?.();
  record.visual.position.copy(record.targetPosition);
  record.visual.quaternion.copy(record.targetQuaternion);
  refreshInitialPose(record);
  refreshCollider(record);
  resetPhysics();
}

function runTactileShowcase() {
  resetPhysics();
  physicsState.wind = true;
  physicsState.showcase = { elapsed: 0, index: 0, nextAt: 0.08 };
  const windButton = document.querySelector('#wind-toggle');
  if (windButton) windButton.textContent = 'Breeze off';
  status.textContent = 'Tactile showcase · sequential impacts + soft recovery';
}

window.plushAlphabet = {
  list: physicsState.records.map(({ id, character, visual }) => ({
    id,
    character,
    physics: visual.userData.physics,
    softBody: visual.userData.softBody,
  })),
  getLetter: (letter) => alphabet.userData.getLetter(letter),
  setColor: (letter, color) => alphabet.userData.setColor(letter, color),
  setAllColor: (color) => alphabet.userData.setAllColor(color),
  setScale: (letter, value) => {
    alphabet.userData.setScale(letter, value);
    refreshStylePhysics(letter);
  },
  setDepth: (letter, value) => {
    alphabet.userData.setDepth(letter, value);
    refreshStylePhysics(letter);
  },
  setSoftness: (letter, value) => {
    const glyph = alphabet.userData.getLetter(letter);
    glyph?.userData?.setSoftness?.(value);
    status.textContent = `${String(letter).toUpperCase()} softness ${Number(value).toFixed(2)} · squash response ready`;
  },
  setBounce: (letter, value) => {
    const record = physicsState.records.find((item) => item.character === String(letter).toUpperCase());
    if (!record) return;
    record.visual.userData.physics.restitution = Math.max(0.05, Math.min(0.92, Number(value) || 0.1));
    refreshCollider(record);
    status.textContent = `${record.character} bounce ${record.visual.userData.physics.restitution.toFixed(2)} · collider refreshed`;
  },
  squish: (letter, strength = 0.9) => {
    const record = physicsState.records.find((item) => item.character === String(letter).toUpperCase());
    if (!record) return;
    triggerSoftImpact(record, strength, record.visual.position.x >= 0 ? 1 : -1);
  },
  impactWave: (letter, strength = 0.9) => {
    const record = physicsState.records.find((item) => item.character === String(letter).toUpperCase());
    triggerImpactWave(record, strength);
  },
  toggleWind: (enabled = !physicsState.wind) => {
    physicsState.wind = Boolean(enabled);
    status.textContent = physicsState.wind ? 'Fiber breeze on · letters softly breathing' : 'Fiber breeze off · soft-body idle';
    return physicsState.wind;
  },
  showcase: runTactileShowcase,
  assemble: assembleWord,
  drop: startPhysics,
  reset: resetPhysics,
  impulse: impulseGlyph,
};

const letterSelect = document.querySelector('#alphabet-letter');
const wordInput = document.querySelector('#alphabet-word');
const colorInput = document.querySelector('#alphabet-color');
const scaleInput = document.querySelector('#alphabet-scale');
const depthInput = document.querySelector('#alphabet-depth');
const softnessInput = document.querySelector('#alphabet-softness');
const bounceInput = document.querySelector('#alphabet-bounce');
const scaleValue = document.querySelector('#alphabet-scale-value');
const depthValue = document.querySelector('#alphabet-depth-value');
const softnessValue = document.querySelector('#alphabet-softness-value');
const bounceValue = document.querySelector('#alphabet-bounce-value');
const status = document.querySelector('#alphabet-status');

for (const letter of alphabet.userData.letters) {
  const option = document.createElement('option');
  option.value = letter;
  option.textContent = letter;
  letterSelect.appendChild(option);
}
status.textContent = `${alphabet.userData.letters.length} glyphs · hero detail · individual physics`;

function selectedGlyph() {
  return alphabet.userData.getLetter(letterSelect.value);
}

function updateControlsFromSelection() {
  const glyph = selectedGlyph();
  const style = glyph?.userData?.style;
  if (!style) return;
  colorInput.value = style.color;
  scaleInput.value = String(style.scale);
  depthInput.value = String(style.depth);
  softnessInput.value = String(glyph.userData.softBody?.softness ?? 0.74);
  bounceInput.value = String(glyph.userData.physics?.restitution ?? 0.22);
  scaleValue.textContent = `${Number(style.scale).toFixed(2)}×`;
  depthValue.textContent = `${Number(style.depth).toFixed(2)}×`;
  softnessValue.textContent = Number(softnessInput.value).toFixed(2);
  bounceValue.textContent = Number(bounceInput.value).toFixed(2);
}

function setSelectedColor() {
  alphabet.userData.setColor(letterSelect.value, colorInput.value);
  status.textContent = `${letterSelect.value} updated · color ${colorInput.value}`;
}

function setSelectedScale(value = scaleInput.value) {
  window.plushAlphabet.setScale(letterSelect.value, Number(value));
  scaleValue.textContent = `${Number(value).toFixed(2)}×`;
}

function setSelectedDepth(value = depthInput.value) {
  window.plushAlphabet.setDepth(letterSelect.value, Number(value));
  depthValue.textContent = `${Number(value).toFixed(2)}×`;
}

function setSelectedSoftness(value = softnessInput.value) {
  window.plushAlphabet.setSoftness(letterSelect.value, Number(value));
  softnessValue.textContent = Number(value).toFixed(2);
}

function setSelectedBounce(value = bounceInput.value) {
  window.plushAlphabet.setBounce(letterSelect.value, Number(value));
  bounceValue.textContent = Number(value).toFixed(2);
}

letterSelect.addEventListener('change', updateControlsFromSelection);
document.querySelector('#assemble-word')?.addEventListener('click', () => assembleWord(wordInput?.value || 'TEACHERS'));
wordInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') assembleWord(wordInput.value || 'TEACHERS');
});
document.querySelector('#apply-color').addEventListener('click', setSelectedColor);
document.querySelector('#apply-all').addEventListener('click', () => {
  alphabet.userData.setAllColor(colorInput.value);
  status.textContent = `All ${alphabet.userData.letters.length} glyphs updated · ${colorInput.value}`;
});
document.querySelector('#randomize').addEventListener('click', () => {
  for (const [index, letter] of alphabet.userData.letters.entries()) {
    const hue = (index / alphabet.userData.letters.length + 0.02) % 1;
    const color = new THREE.Color().setHSL(hue, 0.64, 0.57);
    alphabet.userData.setColor(letter, color);
  }
  updateControlsFromSelection();
  status.textContent = `New deterministic palette applied to ${alphabet.userData.letters.length} glyphs`;
});
scaleInput.addEventListener('input', () => setSelectedScale());
depthInput.addEventListener('input', () => setSelectedDepth());
softnessInput.addEventListener('input', () => setSelectedSoftness());
bounceInput.addEventListener('input', () => setSelectedBounce());
document.querySelector('#drop-letters').addEventListener('click', startPhysics);
document.querySelector('#reset-letters').addEventListener('click', resetPhysics);
document.querySelector('#squish-letter')?.addEventListener('click', () => {
  window.plushAlphabet.squish(letterSelect.value, 1.0);
  status.textContent = `${letterSelect.value} soft-body squeeze · springing back`;
});
document.querySelector('#impact-wave')?.addEventListener('click', () => {
  window.plushAlphabet.impactWave(letterSelect.value, 1.0);
  status.textContent = `Impact wave from ${letterSelect.value} · neighbors responding`;
});
document.querySelector('#wind-toggle')?.addEventListener('click', (event) => {
  const enabled = window.plushAlphabet.toggleWind();
  event.currentTarget.textContent = enabled ? 'Breeze off' : 'Breeze on';
});
document.querySelector('#showcase')?.addEventListener('click', runTactileShowcase);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pickMeshes = [];
alphabet.traverse((node) => {
  if (node.isMesh) pickMeshes.push(node);
});
renderer.domElement.addEventListener('pointerup', (event) => {
  if (event.target !== renderer.domElement) return;
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(pickMeshes, false)[0];
  const glyph = hit?.object?.userData?.glyphRoot;
  if (!glyph) return;
  letterSelect.value = glyph.userData.character;
  updateControlsFromSelection();
  impulseGlyph(glyph.userData.physicsBodyId);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

resetPhysics();
updateControlsFromSelection();

const FIXED_STEP = 1 / 60;
let lastFrameAt = performance.now();
let accumulator = 0;
function render(now) {
  const delta = Math.min((now - lastFrameAt) / 1000, 0.1);
  lastFrameAt = now;
  if (physicsState.active) {
    accumulator += delta;
    while (accumulator >= FIXED_STEP) {
      physicsWorld.timestep = FIXED_STEP;
      physicsWorld.step(physicsEvents);
      handleCollisionEvents();
      for (const record of physicsState.records) syncRecord(record);
      accumulator -= FIXED_STEP;
    }
  }
  updateWordAssembly(delta);
  updateSoftBodies(delta);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
