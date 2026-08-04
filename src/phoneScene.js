import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createPlushAlphabet } from './createPlushTypography.js';
import phoneReferenceImageUrl from '../references/phone-green-screen-reference.png?url';
import './phoneScene.css';

const GREEN = '#18ff26';
const PLUM = '#170a17';

const stageElement = document.querySelector('#phone-canvas');
const stageStatus = document.querySelector('#scene-status');
const runtimeLabel = document.querySelector('#runtime-label');
const screenColorInput = document.querySelector('#screen-color');
const letterScaleInput = document.querySelector('#letter-scale');
const letterScaleValue = document.querySelector('#letter-scale-value');
const selectedLetterLabel = document.querySelector('#selected-letter');
const viewButtons = [...document.querySelectorAll('[data-view]')];
const letterButtons = [...document.querySelectorAll('[data-letter]')];

const scene = new THREE.Scene();
scene.background = new THREE.Color(PLUM);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(stageElement.clientWidth, stageElement.clientHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.setAttribute('aria-label', 'Static 3D phone hero canvas');
stageElement.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0.22, 17.5);
camera.lookAt(0, -0.05, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.enableZoom = true;
controls.minDistance = 12;
controls.maxDistance = 23;
controls.minPolarAngle = Math.PI * 0.39;
controls.maxPolarAngle = Math.PI * 0.61;
controls.target.set(0, -0.12, 0);
controls.autoRotate = false;

const pmrem = new THREE.PMREMGenerator(renderer);
const environment = new RoomEnvironment(renderer);
scene.environment = pmrem.fromScene(environment, 0.045).texture;
environment.dispose();
pmrem.dispose();

const hero = new THREE.Group();
hero.name = 'hero-scene-root';
hero.userData.sculptRuntime = {
  hierarchy: 'root -> phone-body -> front-rim/bezel/screen/island/buttons; root -> plush-stage -> independent letters',
  sourceImage: phoneReferenceImageUrl,
  referenceTreatment: 'static procedural reconstruction; rotating video discarded',
};
scene.add(hero);

const phone = new THREE.Group();
phone.name = 'phone-body';
phone.position.set(0, 0.16, 0.0);
phone.rotation.y = 0.055;
phone.userData = {
  actionReady: true,
  partId: 'phone-body',
  sockets: { screen: new THREE.Vector3(0, 0, 0.3), sideButtons: new THREE.Vector3(-2.18, 1.0, 0.0) },
};
hero.add(phone);

const letters = new Map();
let selectedLetter = 'A';

function roundedBox(width, height, depth, radius, segments = 10) {
  return new RoundedBoxGeometry(width, height, depth, segments, radius);
}

function physicalMaterial(options = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: options.color ?? '#ffffff',
    roughness: options.roughness ?? 0.42,
    metalness: options.metalness ?? 0,
    clearcoat: options.clearcoat ?? 0,
    clearcoatRoughness: options.clearcoatRoughness ?? 0.28,
    sheen: options.sheen ?? 0,
    sheenColor: options.sheenColor ?? options.color ?? '#ffffff',
    sheenRoughness: options.sheenRoughness ?? 0.7,
    emissive: options.emissive ?? '#000000',
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
}

function addMesh(parent, name, geometry, material, position, options = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  mesh.userData.partId = options.partId ?? name;
  mesh.userData.actionReady = true;
  parent.add(mesh);
  return mesh;
}

const roseMetal = physicalMaterial({
  color: '#c45d68',
  roughness: 0.23,
  metalness: 0.78,
  clearcoat: 0.72,
  clearcoatRoughness: 0.18,
});
roseMetal.userData.materialId = 'phone-rose-metal';

const roseRim = physicalMaterial({
  color: '#ef8b82',
  roughness: 0.18,
  metalness: 0.74,
  clearcoat: 0.82,
  clearcoatRoughness: 0.14,
});
roseRim.userData.materialId = 'phone-rose-metal';

const bezelMaterial = physicalMaterial({ color: '#050407', roughness: 0.19, metalness: 0.04, clearcoat: 0.35, clearcoatRoughness: 0.16 });
bezelMaterial.userData.materialId = 'bezel-black';

const screenMaterial = physicalMaterial({
  color: GREEN,
  roughness: 0.16,
  metalness: 0,
  clearcoat: 0.18,
  clearcoatRoughness: 0.24,
  emissive: GREEN,
  emissiveIntensity: 0.27,
});
screenMaterial.userData.materialId = 'screen-green';
screenMaterial.userData.screenSlot = true;

const islandMaterial = physicalMaterial({ color: '#010102', roughness: 0.10, metalness: 0.0, clearcoat: 0.62, clearcoatRoughness: 0.12 });
islandMaterial.userData.materialId = 'island-black';
const lensMaterial = physicalMaterial({ color: '#3a7dff', roughness: 0.08, metalness: 0.0, clearcoat: 0.72, clearcoatRoughness: 0.08, emissive: '#2255aa', emissiveIntensity: 0.45 });
lensMaterial.userData.materialId = 'lens-blue';

addMesh(phone, 'phone-body.mesh', roundedBox(4.3, 8.3, 0.52, 0.28, 12), roseMetal, [0, 0, 0], { partId: 'phone-body' });
addMesh(phone, 'phone-front-rim.mesh', roundedBox(4.12, 8.12, 0.105, 0.22, 12), roseRim, [0, 0.02, 0.285], { partId: 'phone-front-rim' });
addMesh(phone, 'phone-bezel.mesh', roundedBox(3.95, 7.86, 0.15, 0.20, 12), bezelMaterial, [0, 0.02, 0.345], { partId: 'phone-bezel' });
const screen = addMesh(phone, 'screen.slot', roundedBox(3.60, 7.50, 0.07, 0.17, 14), screenMaterial, [0, 0.02, 0.445], { partId: 'screen' });
screen.userData.screenSlot = { id: 'screen-green', replaceable: true, coordinateSpace: 'screen-local' };

const island = addMesh(phone, 'dynamic-island.pill', roundedBox(1.02, 0.31, 0.11, 0.145, 12), islandMaterial, [0, 3.09, 0.50], { partId: 'dynamic-island' });
island.userData.socket = 'lens-seat';
const lens = addMesh(phone, 'dynamic-island-lens.glint', new THREE.SphereGeometry(0.062, 18, 12), lensMaterial, [0.32, 3.09, 0.58], { partId: 'dynamic-island-lens' });
lens.scale.set(1, 0.9, 0.45);

const buttonBaseMaterial = physicalMaterial({ color: '#b84f5d', roughness: 0.24, metalness: 0.72, clearcoat: 0.60, clearcoatRoughness: 0.18 });
buttonBaseMaterial.userData.materialId = 'phone-rose-metal';
const buttonMaterial = physicalMaterial({ color: '#e27976', roughness: 0.18, metalness: 0.74, clearcoat: 0.72, clearcoatRoughness: 0.14 });
buttonMaterial.userData.materialId = 'phone-rose-metal';
addMesh(phone, 'side-button-rail.mesh', roundedBox(0.16, 2.26, 0.16, 0.055, 8), buttonBaseMaterial, [-2.18, 0.88, 0.12], { partId: 'side-button-rail' });
const buttonSpecs = [
  ['button-up', 1.60, 0.46],
  ['button-down', 0.93, 0.46],
  ['button-action', 0.18, 0.72],
];
for (const [name, y, height] of buttonSpecs) {
  const button = addMesh(phone, `${name}.mesh`, roundedBox(0.18, height, 0.20, 0.07, 8), buttonMaterial, [-2.27, y, 0.18], { partId: name });
  button.userData.pressAxis = 'x';
}

function makeGradientTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(256, 470, 10, 256, 560, 720);
  gradient.addColorStop(0, '#3c1c3a');
  gradient.addColorStop(0.45, '#241025');
  gradient.addColorStop(1, '#100711');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshBasicMaterial({ map: makeGradientTexture(), side: THREE.DoubleSide }),
);
backdrop.name = 'studio-backdrop';
backdrop.position.set(0, 0.4, -2.25);
scene.add(backdrop);

const groundMaterial = physicalMaterial({ color: '#2b1328', roughness: 0.68, metalness: 0.0 });
groundMaterial.userData.materialId = 'stage-plum';
const ground = new THREE.Mesh(new THREE.PlaneGeometry(24, 20), groundMaterial);
ground.name = 'studio-ground';
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -4.01, 0.1);
ground.receiveShadow = true;
scene.add(ground);

function makeRadialShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(256, 128, 16, 256, 128, 245);
  gradient.addColorStop(0, 'rgba(5, 0, 8, .56)');
  gradient.addColorStop(0.45, 'rgba(12, 2, 14, .30)');
  gradient.addColorStop(1, 'rgba(12, 2, 14, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(6.3, 3.4),
  new THREE.MeshBasicMaterial({ map: makeRadialShadowTexture(), transparent: true, depthWrite: false, opacity: 0.88 }),
);
shadow.name = 'soft-contact-shadow';
shadow.rotation.x = -Math.PI / 2;
shadow.position.set(0, -3.985, 0.34);
scene.add(shadow);

const keyLight = new THREE.DirectionalLight('#ffd4ca', 4.1);
keyLight.position.set(-5.5, 8.5, 9.5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -7;
keyLight.shadow.camera.right = 7;
keyLight.shadow.camera.top = 9;
keyLight.shadow.camera.bottom = -8;
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 30;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight('#b9baff', 1.35);
fillLight.position.set(5.0, 2.5, 7.0);
scene.add(fillLight);

const rimLight = new THREE.PointLight('#f5a4cf', 2.2, 22, 1.8);
rimLight.position.set(0, 6.4, -3.2);
scene.add(rimLight);

const ambient = new THREE.HemisphereLight('#f2d4e9', '#160918', 1.15);
scene.add(ambient);

const plushStage = new THREE.Group();
plushStage.name = 'plush-stage';
plushStage.userData = { actionReady: true, independentParts: ['A', 'B', 'O', 'D'] };
hero.add(plushStage);

const plushSpecs = [
  { letter: 'A', color: '#ee705d', position: [-2.48, -2.78, 0.02], rotation: -0.05, scale: 1.38 },
  { letter: 'B', color: '#8d56a6', position: [-2.10, -0.78, -0.78], rotation: 0.02, scale: 1.46 },
  { letter: 'O', color: '#8d56a6', position: [2.14, -0.64, -0.74], rotation: -0.02, scale: 1.44 },
  { letter: 'D', color: '#f4b22d', position: [2.52, -2.76, 0.03], rotation: 0.045, scale: 1.33 },
];

async function buildPlushLetters() {
  for (const spec of plushSpecs) {
    const root = await createPlushAlphabet({
      characters: spec.letter,
      size: 1.48,
      editableColor: true,
      textureSize: 512,
      curveSegments: 28,
      bevelSegments: 12,
      columns: 1,
      rowGap: 0,
    });
    root.name = `plush-letter-${spec.letter}`;
    root.position.set(...spec.position);
    root.rotation.z = spec.rotation;
    root.scale.setScalar(spec.scale);
    root.userData.partId = `plush-letter-${spec.letter}`;
    root.userData.independent = true;
    root.userData.physicsReady = true;
    root.userData.defaultTransform = {
      position: [...spec.position],
      rotationZ: spec.rotation,
      scale: spec.scale,
      color: spec.color,
    };
    root.userData.setColor(spec.color);
    plushStage.add(root);
    letters.set(spec.letter, root);
  }
}

function getGlyphRoot(letter) {
  return letters.get(String(letter).toUpperCase()) ?? null;
}

function setScreenColor(color) {
  const next = new THREE.Color(color);
  screenMaterial.color.copy(next);
  screenMaterial.emissive.copy(next);
  screenMaterial.userData.screenColor = `#${next.getHexString()}`;
  screenColorInput.value = `#${next.getHexString()}`;
}

function setLetterColor(letter, color) {
  const root = getGlyphRoot(letter);
  root?.userData?.setColor?.(color);
}

function setSelectedLetter(letter) {
  selectedLetter = String(letter).toUpperCase();
  letterButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.letter === selectedLetter));
  const root = getGlyphRoot(selectedLetter);
  if (!root) return;
  const currentScale = root.userData.style?.scale ?? root.userData.defaultTransform.scale;
  letterScaleInput.value = String(currentScale);
  letterScaleValue.textContent = Number(currentScale).toFixed(2);
  selectedLetterLabel.textContent = `${selectedLetter} selected · independent root ready`;
}

const views = {
  front: { camera: [0, 0.22, 17.5], target: [0, -0.12, 0], phoneY: 0.055 },
  'three-quarter': { camera: [-1.15, 0.36, 17.1], target: [0, -0.14, 0], phoneY: 0.16 },
  side: { camera: [-5.5, 0.55, 14.7], target: [0, -0.1, 0], phoneY: 0.30 },
};

function setView(name) {
  const view = views[name] ?? views.front;
  camera.position.set(...view.camera);
  controls.target.set(...view.target);
  phone.rotation.y = view.phoneY;
  controls.update();
  viewButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.view === name));
}

function resetScene() {
  setScreenColor(GREEN);
  setView('front');
  for (const spec of plushSpecs) {
    const root = getGlyphRoot(spec.letter);
    if (!root) continue;
    root.position.set(...spec.position);
    root.rotation.z = spec.rotation;
    root.scale.setScalar(spec.scale);
    root.userData.setColor(spec.color);
  }
  setSelectedLetter('A');
}

function focusScreen() {
  camera.position.set(0, 0.24, 14.0);
  controls.target.set(0, 0.32, 0.15);
  phone.rotation.y = 0.035;
  controls.update();
}

function resize() {
  const width = Math.max(1, stageElement.clientWidth);
  const height = Math.max(1, stageElement.clientHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

for (const button of viewButtons) button.addEventListener('click', () => setView(button.dataset.view));
for (const button of letterButtons) button.addEventListener('click', () => setSelectedLetter(button.dataset.letter));
screenColorInput.addEventListener('input', (event) => setScreenColor(event.target.value));
document.querySelector('#screen-reset')?.addEventListener('click', () => setScreenColor(GREEN));
document.querySelector('#reset-scene')?.addEventListener('click', resetScene);
document.querySelector('#focus-screen')?.addEventListener('click', focusScreen);
letterScaleInput.addEventListener('input', (event) => {
  const value = Number(event.target.value);
  const root = getGlyphRoot(selectedLetter);
  if (!root) return;
  root.userData.setScale?.(value);
  letterScaleValue.textContent = value.toFixed(2);
});
window.addEventListener('resize', resize);

await buildPlushLetters();
resize();
resetScene();
stageStatus.textContent = 'STATIC PROCEDURAL HERO · NO VIDEO ROTATION';
runtimeLabel.textContent = 'OBJECT TREE READY · 4 PLUSH ROOTS';

window.phoneScene = {
  scene,
  camera,
  renderer,
  hero,
  phone,
  screen,
  letters,
  controls,
  setScreenColor,
  setLetterColor,
  setView,
  reset: resetScene,
  getObject(letter) { return getGlyphRoot(letter); },
};

const clock = new THREE.Clock();
function render() {
  requestAnimationFrame(render);
  const delta = Math.min(clock.getDelta(), 0.05);
  controls.update(delta);
  renderer.render(scene, camera);
}
render();
