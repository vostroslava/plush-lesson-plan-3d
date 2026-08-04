import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { createPlushTypography } from './createPlushTypography.js';
import './style.css';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x08070b);
const query = new URLSearchParams(window.location.search);
if (query.has('reference')) {
  scene.background = new THREE.Color(0xfcf2e2);
}
if (query.has('clean')) {
  document.querySelector('#app').classList.add('clean');
}

const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, -0.05, 6.45);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.querySelector('#app').appendChild(renderer.domElement);

const typography = await createPlushTypography({ phrase: 'Teachers: How to create a lesson plan in 30 seconds' });
const verticalOffset = query.has('reference') ? -0.50 : -0.05;
typography.position.y = verticalOffset;
scene.add(typography);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(14, 8),
  new THREE.MeshPhysicalMaterial({ color: query.has('reference') ? 0xfcf2e2 : 0x241827, roughness: 0.92, metalness: 0.0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1.78;
ground.position.z = -0.18;
ground.visible = !query.has('reference');
ground.receiveShadow = true;
scene.add(ground);

const key = new THREE.DirectionalLight(0xffe2c3, 3.0);
key.position.set(-3.5, 4.5, 5.0);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -5;
key.shadow.camera.right = 5;
key.shadow.camera.top = 4;
key.shadow.camera.bottom = -4;
scene.add(key);

const frontFill = new THREE.DirectionalLight(0xfff7ec, 3.8);
frontFill.position.set(0.2, 2.2, 6.0);
scene.add(frontFill);

const fill = new THREE.DirectionalLight(0x7caaff, 1.1);
fill.position.set(4.0, 1.4, 2.6);
scene.add(fill);

const rim = new THREE.PointLight(0xff5bbf, 18, 7, 2);
rim.position.set(-1.3, 1.3, -1.8);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0x6a4d78, 0x241827, 1.15));
scene.add(new THREE.AmbientLight(0xffe8d2, 0.34));

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 3.4;
controls.maxDistance = 7.0;
controls.target.set(0, 0.05, 0);

const views = {
  front: { position: [0, -0.05, 6.45], target: [0, -0.05, 0] },
  'three-quarter': { position: [2.55, 0.72, 5.8], target: [0, -0.05, 0] },
  side: { position: [6.35, 0.05, 0.04], target: [0, -0.05, 0] },
};

const initialView = new URLSearchParams(window.location.search).get('view');
if (initialView && views[initialView]) {
  camera.position.set(...views[initialView].position);
  controls.target.set(...views[initialView].target);
  controls.update();
}

await RAPIER.init();
const physicsWorld = new RAPIER.World({ x: 0, y: -5.5, z: 0 });
const groundBody = physicsWorld.createRigidBody(
  RAPIER.RigidBodyDesc.fixed().setTranslation(0, ground.position.y - 0.08, ground.position.z),
);
physicsWorld.createCollider(
  RAPIER.ColliderDesc.cuboid(7, 0.08, 4)
    .setFriction(0.92)
    .setRestitution(0.08),
  groundBody,
);

const physicsState = {
  active: false,
  records: [],
};

typography.updateMatrixWorld(true);
const pickMeshes = [];
typography.traverse((node) => {
  if (!node.name.startsWith('glyph.') || !node.userData?.physics) return;
  const physicsData = node.userData.physics;
  const parent = node.parent;
  const worldScale = node.getWorldScale(new THREE.Vector3());
  const centerOffset = new THREE.Vector3(...physicsData.centerOffset);
  const bodyCenter = node.localToWorld(centerOffset.clone());
  const worldHalfExtents = new THREE.Vector3(
    physicsData.halfExtents[0] * worldScale.x,
    physicsData.halfExtents[1] * worldScale.y,
    physicsData.halfExtents[2] * worldScale.z,
  );
  const worldQuaternion = node.getWorldQuaternion(new THREE.Quaternion());
  const body = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(bodyCenter.x, bodyCenter.y, bodyCenter.z)
      .setRotation({ x: worldQuaternion.x, y: worldQuaternion.y, z: worldQuaternion.z, w: worldQuaternion.w })
      .setAdditionalMass(physicsData.mass)
      .setLinearDamping(physicsData.linearDamping)
      .setAngularDamping(physicsData.angularDamping)
      .setCanSleep(true),
  );
  const collider = physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(worldHalfExtents.x, worldHalfExtents.y, worldHalfExtents.z)
      .setFriction(physicsData.friction)
      .setRestitution(physicsData.restitution),
    body,
  );
  body.setGravityScale(0, true);
  const translation = body.translation();
  const rotation = body.rotation();
  const record = {
    id: node.name,
    character: node.userData.character,
    visual: node,
    parent,
    centerOffset: new THREE.Vector3(...physicsData.centerOffset),
    worldScale,
    body,
    collider,
    initial: {
      translation: { x: translation.x, y: translation.y, z: translation.z },
      rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
    },
  };
  node.userData.physicsBodyId = record.id;
  node.userData.physicsBody = body;
  node.traverse((child) => {
    if (child.isMesh) {
      child.userData.glyphRoot = node;
      pickMeshes.push(child);
    }
  });
  physicsState.records.push(record);
});

function syncPhysicsRecord(record) {
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

function syncPhysicsVisuals() {
  typography.updateMatrixWorld(true);
  for (const record of physicsState.records) syncPhysicsRecord(record);
}

function setPhysicsRootPose() {
  typography.position.y = verticalOffset;
  typography.rotation.set(0, 0, 0);
  typography.updateMatrixWorld(true);
}

function startPhysics() {
  if (physicsState.active) return;
  setPhysicsRootPose();
  physicsState.active = true;
  ground.visible = true;
  for (const [index, record] of physicsState.records.entries()) {
    record.body.setGravityScale(1, true);
    record.body.wakeUp();
    const phase = index * 1.61803398875;
    record.body.applyImpulse({
      x: Math.sin(phase) * 0.045,
      y: 0.025 + (index % 3) * 0.018,
      z: Math.cos(phase) * 0.11,
    }, true);
    record.body.applyTorqueImpulse({
      x: Math.cos(phase * 0.7) * 0.018,
      y: Math.sin(phase * 0.9) * 0.014,
      z: Math.cos(phase * 1.3) * 0.018,
    }, true);
    record.visual.userData.triggerSquash?.(0.22 + (index % 3) * 0.035, index % 2 === 0 ? 1 : -1);
  }
}

function resetPhysics() {
  physicsState.active = false;
  setPhysicsRootPose();
  for (const record of physicsState.records) {
    record.body.setGravityScale(0, true);
    record.body.setTranslation(record.initial.translation, true);
    record.body.setRotation(record.initial.rotation, true);
    record.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    record.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    record.body.wakeUp();
    record.visual.userData.resetSoftBody?.();
  }
  ground.visible = !query.has('reference');
  syncPhysicsVisuals();
}

function impulseGlyph(id, impulse = { x: 0.18, y: 0.34, z: 0.42 }) {
  if (!physicsState.active) startPhysics();
  const record = physicsState.records.find((item) => item.id === id);
  if (!record) return false;
  record.body.wakeUp();
  record.body.applyImpulse(impulse, true);
  record.body.applyTorqueImpulse({ x: impulse.z * 0.16, y: impulse.x * -0.12, z: impulse.y * 0.1 }, true);
  record.visual.userData.triggerSquash?.(Math.min(0.9, Math.hypot(impulse.x, impulse.y, impulse.z)), impulse.x >= 0 ? 1 : -1);
  return true;
}

window.plushTypography = {
  list: physicsState.records.map(({ id, character }) => ({ id, character })),
  drop: startPhysics,
  reset: resetPhysics,
  impulse: impulseGlyph,
  getGlyph: (id) => physicsState.records.find((record) => record.id === id)?.visual ?? null,
};

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDown = null;
renderer.domElement.addEventListener('pointerdown', (event) => {
  pointerDown = { x: event.clientX, y: event.clientY };
});
renderer.domElement.addEventListener('pointerup', (event) => {
  if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 8) {
    pointerDown = null;
    return;
  }
  pointerDown = null;
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(pickMeshes, false)[0];
  if (!hit) return;
  const glyph = hit.object.userData.glyphRoot;
  if (!glyph?.userData?.physicsBodyId) return;
  impulseGlyph(glyph.userData.physicsBodyId, {
    x: (event.clientX / window.innerWidth - 0.5) * 0.28,
    y: 0.34,
    z: 0.48,
  });
});

for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', () => {
    if (button.dataset.action === 'drop') startPhysics();
    if (button.dataset.action === 'reset') resetPhysics();
  });
}

if (query.has('physics')) startPhysics();

for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => {
    for (const item of document.querySelectorAll('[data-view]')) item.classList.remove('active');
    button.classList.add('active');
    const view = views[button.dataset.view];
    camera.position.set(...view.position);
    controls.target.set(...view.target);
    controls.update();
  });
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
function render() {
  const delta = Math.min(clock.getDelta(), 1 / 20);
  const elapsed = clock.elapsedTime;
  if (physicsState.active) {
    physicsWorld.timestep = delta;
    physicsWorld.step();
    syncPhysicsVisuals();
  } else {
    typography.position.y = verticalOffset + Math.sin(elapsed * 0.7) * 0.012;
    typography.rotation.y = Math.sin(elapsed * 0.25) * 0.018;
  }
  for (const record of physicsState.records) {
    record.visual.userData.updateSoftBody?.(delta, physicsState.active ? 0 : 0.006);
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
render();
