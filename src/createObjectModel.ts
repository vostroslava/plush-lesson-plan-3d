import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions): THREE.MeshPhysicalMaterial {
  const textures = makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : new THREE.Color(typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F'),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clamp01(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: Math.max(1, readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: Math.max(1, readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clamp01(readLayerNumber(spec.specularIntensity, ['base'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    if (bumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = bumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    if (displacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = displacementScale;
      material.displacementBias = -displacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Plush Lesson Plan Typography
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createPlushLessonPlanTypographyModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Plush Lesson Plan Typography";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 32.0, "aspect": 1.8224, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 4.0], "projection": "near-orthographic frontal product view", "note": "The reference is nearly frontal with weak perspective. Use an orthographic or long-lens review camera and compare all three rows at the same framing."}, "approximationNotes": []};

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["fabric"] = createSculptMaterial(
    "fabric",
    {"id": "fabric", "name": "Short-pile plush fabric", "type": "physical", "qualityTier": "hero", "shaderModel": "MeshPhysicalMaterial with independent procedural albedo, roughness, normal, height, and AO response", "baseColor": "#C73F1E", "color": "#C73F1E", "albedo": {"dominant": "#C73F1E", "secondary": ["#E87031", "#F1B850", "#5E9CC7", "#8B5AAE", "#E8839E", "#37B8B2"], "samplingNotes": "Palette sampled from visible plush glyphs; final color is selected per glyph instance."}, "colorVariation": {"palette": ["#C73F1E", "#E87031", "#F1B850", "#79A84B", "#4F91C9", "#8B5AAE", "#E8839E", "#37B8B2"], "pattern": "per-glyph palette with low-amplitude pile variation", "amplitude": 0.12, "heightCorrelation": 0.15}, "textureResolution": 1024, "textureProjection": {"mode": "object-local procedural", "repeat": [3.0, 3.0], "anisotropy": 8, "texelDensityIntent": "Keep pile scale stable across all glyph instances."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.06, "role": "inflated padded value gradient"}, {"id": "meso", "frequency": 18.0, "amplitude": 0.08, "role": "compressed plush and seam-adjacent breakup"}, {"id": "micro", "frequency": 96.0, "amplitude": 0.04, "role": "short pile highlight breakup"}], "roughness": {"base": 0.8, "variation": 0.12, "map": "independent-plush-roughness", "localResponse": "slightly lower on broad pile highlights and higher in compressed seam/cavity zones"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "independent short-pile normal", "strength": 0.22, "scale": 96.0, "space": "tangent"}, "bump": {"pattern": "fiber-cluster bump", "amplitude": 0.12, "scale": 64.0}, "displacement": {"pattern": "padded front macro inflation", "amplitude": 0.012, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.28, "map": "independent-plush-ao", "notes": "Deepen counters, perimeter seam cavity, inter-letter gaps, and ground contact."}, "wear": {"edgeWear": 0.03, "scratches": [], "chips": []}, "dirt": {"amount": 0.02, "cavityBias": 0.18, "color": "#6A2B26"}, "localOverrides": [{"id": "per-glyph-albedo", "region": "glyph-instance", "baseColor": "palette-slot", "evidenceRefs": ["full-object"]}, {"id": "short-pile-relief", "region": "front-and-side-faces", "normalStrength": 0.22, "roughness": 0.82, "evidenceRefs": ["full-object", "review/material-evidence/report.json"]}, {"id": "seam-and-cavity", "region": "glyph-perimeter-and-counters", "roughness": 0.86, "aoStrength": 0.42, "evidenceRefs": ["full-object"]}, {"id": "soft-contact-shadow", "region": "ground-contact", "aoStrength": 0.4, "evidenceRefs": ["full-object"]}], "referencePbr": {"usable": true, "confidence": 0.86, "estimatedFidelity": 0.86, "sourceImage": "review/zone-r0c0.png", "maps": {"albedo": {"url": "review/material-evidence/plush-fabric_albedo.png", "channel": "albedo"}, "roughness": {"url": "review/material-evidence/plush-fabric_roughness.png", "channel": "roughness"}, "height": {"url": "review/material-evidence/plush-fabric_height.png", "channel": "height"}, "normal": {"url": "review/material-evidence/plush-fabric_normal.png", "channel": "normal"}, "ao": {"url": "review/material-evidence/plush-fabric_ao.png", "channel": "ao"}}}, "notes": "Single-image PBR extraction is reference-derived evidence, not exact inverse rendering."},
    options
  );
  materialMap["seam"] = createSculptMaterial(
    "seam",
    {"id": "seam", "name": "Darker stitched seam", "type": "physical", "qualityTier": "utility", "shaderModel": "MeshPhysicalMaterial dielectric textile accent", "baseColor": "#7B2E27", "color": "#7B2E27", "albedo": {"dominant": "#7B2E27", "secondary": ["#B34F3A"], "samplingNotes": "Darker edge/cavity response observed around the plush perimeter."}, "colorVariation": {"palette": ["#7B2E27", "#B34F3A"], "pattern": "raised seam contrast", "amplitude": 0.1, "heightCorrelation": 0.2}, "textureResolution": 1024, "textureProjection": {"mode": "object-local", "repeat": [4.0, 4.0], "anisotropy": 4, "texelDensityIntent": "Stable stitch scale across repeated glyphs."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.02, "role": "seam path"}, {"id": "meso", "frequency": 24.0, "amplitude": 0.05, "role": "stitched ridge"}, {"id": "micro", "frequency": 96.0, "amplitude": 0.02, "role": "thread breakup"}], "roughness": {"base": 0.76, "variation": 0.08, "map": "seam-independent-roughness", "localResponse": "higher in the cavity adjacent to the raised seam"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "stitched ridge normal", "strength": 0.14, "scale": 48.0, "space": "tangent"}, "bump": {"pattern": "thread micro-bump", "amplitude": 0.08, "scale": 64.0}, "displacement": {"pattern": "raised contour geometry", "amplitude": 0.01, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.32, "contactShadowBias": 0.25, "map": "seam-ao", "notes": "Keep seam readable without a hard plastic outline."}, "localOverrides": [{"id": "seam-and-cavity", "region": "glyph-contour", "roughness": 0.82, "evidenceRefs": ["full-object"]}], "notes": "Utility accent material shares the fabric color slot but remains independently addressable."},
    options
  );
  materialMap["ground"] = createSculptMaterial(
    "ground",
    {"id": "ground", "name": "Warm neutral ground", "type": "physical", "qualityTier": "utility", "shaderModel": "MeshStandardMaterial matte dielectric", "baseColor": "#FCF2E2", "color": "#FCF2E2", "albedo": {"dominant": "#FCF2E2", "secondary": ["#E8D3B7"], "samplingNotes": "Warm off-white background/ground from reference."}, "roughness": {"base": 0.9, "variation": 0.03, "map": "ground-roughness", "localResponse": "softens contact shadow transition"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.2, "contactShadowBias": 0.2, "notes": "Ground receives soft shadows."}, "notes": "Utility material for reference-matched presentation."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_root_0 = null;
  const endpoint_root_0 = makeAttachmentEndpoint(attachment_root_0);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Plush Lesson Plan Scene__pivot";
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0, 0, 0);
    node_root_0.scale.set(1, 1, 1);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
    node_root_0.scale.set(1.0, 1.0, 1.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Plush Lesson Plan Scene", "level": "macro", "role": "root", "importance": 1.0, "confidence": 0.96, "primitive": "instanced-cluster", "topologyClass": "material-only", "topologyRationale": "The root is a named scene pivot; visible geometry is owned by independent row and glyph children.", "parent": null, "dimensions": {"width": 5.4, "height": 3.1, "depth": 0.34, "units": "relative", "confidence": 0.86}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "compound-typography", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "typography-scene", "seamRefs": [], "detachableFragments": ["line-top", "line-middle", "line-bottom"], "breakImpulse": 0, "debrisMaterial": "fabric"}}, "materialLayers": [], "localFeatures": [{"id": "referenceCamera", "kind": "camera-framing", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "notes": "Scene pivot only."}, "evidenceRefs": ["full-object"], "fidelityTier": "blockout"};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "compound-typography", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "typography-scene", "seamRefs": [], "detachableFragments": ["line-top", "line-middle", "line-bottom"], "breakImpulse": 0, "debrisMaterial": "fabric"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["fabric"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Plush Lesson Plan Scene";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Plush Lesson Plan Scene", "level": "macro", "role": "root", "importance": 1.0, "confidence": 0.96, "primitive": "instanced-cluster", "topologyClass": "material-only", "topologyRationale": "The root is a named scene pivot; visible geometry is owned by independent row and glyph children.", "parent": null, "dimensions": {"width": 5.4, "height": 3.1, "depth": 0.34, "units": "relative", "confidence": 0.86}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "compound-typography", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "typography-scene", "seamRefs": [], "detachableFragments": ["line-top", "line-middle", "line-bottom"], "breakImpulse": 0, "debrisMaterial": "fabric"}}, "materialLayers": [], "localFeatures": [{"id": "referenceCamera", "kind": "camera-framing", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "notes": "Scene pivot only."}, "evidenceRefs": ["full-object"], "fidelityTier": "blockout"};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "compound-typography", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false};
  destructionGroups["typography-scene"] ??= [];
  destructionGroups["typography-scene"].push(node_root_0);

  const attachment_typography_layout_1 = null;
  const endpoint_typography_layout_1 = makeAttachmentEndpoint(attachment_typography_layout_1);
  const node_typography_layout_1 = new THREE.Group();
  node_typography_layout_1.name = "Editable three-line typography layout__pivot";
  if (endpoint_typography_layout_1) {
    node_typography_layout_1.position.copy(endpoint_typography_layout_1.start);
    node_typography_layout_1.rotation.set(0, 0, 0);
    node_typography_layout_1.scale.set(1, 1, 1);
  } else {
    node_typography_layout_1.position.set(0.0, 0.0, 0.0);
    node_typography_layout_1.rotation.set(0.0, 0.0, 0.0);
    node_typography_layout_1.scale.set(1.0, 1.0, 1.0);
  }
  node_typography_layout_1.userData.sculptComponent = {"id": "typography-layout", "name": "Editable three-line typography layout", "level": "macro", "role": "collection", "importance": 1.0, "confidence": 0.99, "primitive": "instanced-cluster", "topologyClass": "material-only", "topologyRationale": "This named collection owns independent row pivots and repeated glyph instances rather than a fused surface.", "parent": "root", "dimensions": {"width": 5.4, "height": 3.1, "depth": 0.34, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "typography-controller", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": true, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "topRow", "localPosition": [0, 0.94, 0], "localRotation": [0, 0, 0]}, {"id": "middleRow", "localPosition": [0, 0.0, 0], "localRotation": [0, 0, 0]}, {"id": "bottomRow", "localPosition": [0, -0.86, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "compound-rows", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "typography-rows", "seamRefs": [], "detachableFragments": ["line-top", "line-middle", "line-bottom"], "breakImpulse": 0, "debrisMaterial": "fabric"}}, "materialLayers": [], "localFeatures": [{"id": "exactPhrase", "kind": "linework", "evidenceRefs": ["full-object"]}, {"id": "lineBreaks", "kind": "linework", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "notes": "Controller group; glyphs provide visible surfaces."}, "evidenceRefs": ["full-object"], "fidelityTier": "blockout"};
  node_typography_layout_1.userData.actionProfile = {"animationRole": "typography-controller", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": true, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "topRow", "localPosition": [0, 0.94, 0], "localRotation": [0, 0, 0]}, {"id": "middleRow", "localPosition": [0, 0.0, 0], "localRotation": [0, 0, 0]}, {"id": "bottomRow", "localPosition": [0, -0.86, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "compound-rows", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "typography-rows", "seamRefs": [], "detachableFragments": ["line-top", "line-middle", "line-bottom"], "breakImpulse": 0, "debrisMaterial": "fabric"}};
  (nodes["root"] ?? root).add(node_typography_layout_1);
  nodes["typography-layout"] = node_typography_layout_1;
  const mesh_typography_layout_1Geometry = endpoint_typography_layout_1
    ? new THREE.CylinderGeometry(endpoint_typography_layout_1.endRadius, endpoint_typography_layout_1.baseRadius, endpoint_typography_layout_1.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_typography_layout_1 = new THREE.Mesh(
    mesh_typography_layout_1Geometry,
    materialMap["fabric"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_typography_layout_1.name = "Editable three-line typography layout";
  if (endpoint_typography_layout_1) {
    mesh_typography_layout_1.position.copy(endpoint_typography_layout_1.midpoint);
    mesh_typography_layout_1.quaternion.copy(endpoint_typography_layout_1.quaternion);
  }
  mesh_typography_layout_1.castShadow = options.castShadow ?? true;
  mesh_typography_layout_1.receiveShadow = options.receiveShadow ?? true;
  mesh_typography_layout_1.userData.sculptComponent = {"id": "typography-layout", "name": "Editable three-line typography layout", "level": "macro", "role": "collection", "importance": 1.0, "confidence": 0.99, "primitive": "instanced-cluster", "topologyClass": "material-only", "topologyRationale": "This named collection owns independent row pivots and repeated glyph instances rather than a fused surface.", "parent": "root", "dimensions": {"width": 5.4, "height": 3.1, "depth": 0.34, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "typography-controller", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": true, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "topRow", "localPosition": [0, 0.94, 0], "localRotation": [0, 0, 0]}, {"id": "middleRow", "localPosition": [0, 0.0, 0], "localRotation": [0, 0, 0]}, {"id": "bottomRow", "localPosition": [0, -0.86, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "compound-rows", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "typography-rows", "seamRefs": [], "detachableFragments": ["line-top", "line-middle", "line-bottom"], "breakImpulse": 0, "debrisMaterial": "fabric"}}, "materialLayers": [], "localFeatures": [{"id": "exactPhrase", "kind": "linework", "evidenceRefs": ["full-object"]}, {"id": "lineBreaks", "kind": "linework", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "notes": "Controller group; glyphs provide visible surfaces."}, "evidenceRefs": ["full-object"], "fidelityTier": "blockout"};
  node_typography_layout_1.add(mesh_typography_layout_1);
  meshes["typography-layout"] = mesh_typography_layout_1;
  colliders["typography-layout"] = {"type": "compound-rows", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false};
  destructionGroups["typography-rows"] ??= [];
  destructionGroups["typography-rows"].push(node_typography_layout_1);
  const socket_typography_layout_topRow_0 = new THREE.Object3D();
  socket_typography_layout_topRow_0.name = "topRow";
  socket_typography_layout_topRow_0.position.set(0.0, 0.94, 0.0);
  socket_typography_layout_topRow_0.rotation.set(0.0, 0.0, 0.0);
  socket_typography_layout_topRow_0.userData.socket = {"id": "topRow", "localPosition": [0, 0.94, 0], "localRotation": [0, 0, 0]};
  node_typography_layout_1.add(socket_typography_layout_topRow_0);
  sockets["typography-layout:topRow"] = socket_typography_layout_topRow_0;
  const socket_typography_layout_middleRow_1 = new THREE.Object3D();
  socket_typography_layout_middleRow_1.name = "middleRow";
  socket_typography_layout_middleRow_1.position.set(0.0, 0.0, 0.0);
  socket_typography_layout_middleRow_1.rotation.set(0.0, 0.0, 0.0);
  socket_typography_layout_middleRow_1.userData.socket = {"id": "middleRow", "localPosition": [0, 0.0, 0], "localRotation": [0, 0, 0]};
  node_typography_layout_1.add(socket_typography_layout_middleRow_1);
  sockets["typography-layout:middleRow"] = socket_typography_layout_middleRow_1;
  const socket_typography_layout_bottomRow_2 = new THREE.Object3D();
  socket_typography_layout_bottomRow_2.name = "bottomRow";
  socket_typography_layout_bottomRow_2.position.set(0.0, -0.86, 0.0);
  socket_typography_layout_bottomRow_2.rotation.set(0.0, 0.0, 0.0);
  socket_typography_layout_bottomRow_2.userData.socket = {"id": "bottomRow", "localPosition": [0, -0.86, 0], "localRotation": [0, 0, 0]};
  node_typography_layout_1.add(socket_typography_layout_bottomRow_2);
  sockets["typography-layout:bottomRow"] = socket_typography_layout_bottomRow_2;

  const attachment_line_top_2 = null;
  const endpoint_line_top_2 = makeAttachmentEndpoint(attachment_line_top_2);
  const node_line_top_2 = new THREE.Group();
  node_line_top_2.name = "Top row \u2014 TEACHERS colon__pivot";
  if (endpoint_line_top_2) {
    node_line_top_2.position.copy(endpoint_line_top_2.start);
    node_line_top_2.rotation.set(0, 0, 0);
    node_line_top_2.scale.set(1, 1, 1);
  } else {
    node_line_top_2.position.set(0.0, 0.94, 0.0);
    node_line_top_2.rotation.set(0.0, 0.0, 0.0);
    node_line_top_2.scale.set(1.0, 1.0, 1.0);
  }
  node_line_top_2.userData.sculptComponent = {"id": "line-top", "name": "Top row — TEACHERS colon", "level": "meso", "role": "row", "importance": 1.0, "confidence": 0.99, "primitive": "instanced-cluster", "topologyClass": "material-only", "topologyRationale": "A row pivot groups independent letter meshes while preserving each glyph as a detachable object.", "parent": "typography-layout", "dimensions": {"width": 5.0, "height": 1.0, "depth": 0.34, "units": "relative", "confidence": 0.92}, "transform": {"position": [0, 0.94, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "row-top", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.97}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": true, "twist": true, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "compound-glyph-row", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "row-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "fabric"}}, "materialLayers": [], "localFeatures": [{"id": "topRowText", "kind": "linework", "evidenceRefs": ["full-object"]}, {"id": "colonDots", "kind": "contour", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "notes": "TEACHERS: with two separate plush punctuation dots."}, "evidenceRefs": ["full-object"], "fidelityTier": "blockout"};
  node_line_top_2.userData.actionProfile = {"animationRole": "row-top", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.97}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": true, "twist": true, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "compound-glyph-row", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "row-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "fabric"}};
  (nodes["typography-layout"] ?? root).add(node_line_top_2);
  nodes["line-top"] = node_line_top_2;
  const mesh_line_top_2Geometry = endpoint_line_top_2
    ? new THREE.CylinderGeometry(endpoint_line_top_2.endRadius, endpoint_line_top_2.baseRadius, endpoint_line_top_2.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_line_top_2 = new THREE.Mesh(
    mesh_line_top_2Geometry,
    materialMap["fabric"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_line_top_2.name = "Top row \u2014 TEACHERS colon";
  if (endpoint_line_top_2) {
    mesh_line_top_2.position.copy(endpoint_line_top_2.midpoint);
    mesh_line_top_2.quaternion.copy(endpoint_line_top_2.quaternion);
  }
  mesh_line_top_2.castShadow = options.castShadow ?? true;
  mesh_line_top_2.receiveShadow = options.receiveShadow ?? true;
  mesh_line_top_2.userData.sculptComponent = {"id": "line-top", "name": "Top row — TEACHERS colon", "level": "meso", "role": "row", "importance": 1.0, "confidence": 0.99, "primitive": "instanced-cluster", "topologyClass": "material-only", "topologyRationale": "A row pivot groups independent letter meshes while preserving each glyph as a detachable object.", "parent": "typography-layout", "dimensions": {"width": 5.0, "height": 1.0, "depth": 0.34, "units": "relative", "confidence": 0.92}, "transform": {"position": [0, 0.94, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "row-top", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.97}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": true, "twist": true, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "compound-glyph-row", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "row-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "fabric"}}, "materialLayers": [], "localFeatures": [{"id": "topRowText", "kind": "linework", "evidenceRefs": ["full-object"]}, {"id": "colonDots", "kind": "contour", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "notes": "TEACHERS: with two separate plush punctuation dots."}, "evidenceRefs": ["full-object"], "fidelityTier": "blockout"};
  node_line_top_2.add(mesh_line_top_2);
  meshes["line-top"] = mesh_line_top_2;
  colliders["line-top"] = {"type": "compound-glyph-row", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false};
  destructionGroups["row-top"] ??= [];
  destructionGroups["row-top"].push(node_line_top_2);

  const attachment_line_middle_3 = null;
  const endpoint_line_middle_3 = makeAttachmentEndpoint(attachment_line_middle_3);
  const node_line_middle_3 = new THREE.Group();
  node_line_middle_3.name = "Middle row \u2014 HOW TO CREATE A LESSON PLAN__pivot";
  if (endpoint_line_middle_3) {
    node_line_middle_3.position.copy(endpoint_line_middle_3.start);
    node_line_middle_3.rotation.set(0, 0, 0);
    node_line_middle_3.scale.set(1, 1, 1);
  } else {
    node_line_middle_3.position.set(0.0, 0.0, 0.0);
    node_line_middle_3.rotation.set(0.0, 0.0, 0.0);
    node_line_middle_3.scale.set(1.0, 1.0, 1.0);
  }
  node_line_middle_3.userData.sculptComponent = {"id": "line-middle", "name": "Middle row — HOW TO CREATE A LESSON PLAN", "level": "meso", "role": "row", "importance": 1.0, "confidence": 0.99, "primitive": "instanced-cluster", "topologyClass": "material-only", "topologyRationale": "A separate row pivot preserves the long line's spacing and lets the row move independently during the ad.", "parent": "typography-layout", "dimensions": {"width": 5.4, "height": 0.67, "depth": 0.34, "units": "relative", "confidence": 0.92}, "transform": {"position": [0, 0.0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "row-middle", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.97}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": true, "twist": true, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "compound-glyph-row", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "row-middle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "fabric"}}, "materialLayers": [], "localFeatures": [{"id": "middleRowText", "kind": "linework", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "notes": "Longest line; tight spacing must stay readable."}, "evidenceRefs": ["full-object"], "fidelityTier": "blockout"};
  node_line_middle_3.userData.actionProfile = {"animationRole": "row-middle", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.97}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": true, "twist": true, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "compound-glyph-row", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "row-middle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "fabric"}};
  (nodes["typography-layout"] ?? root).add(node_line_middle_3);
  nodes["line-middle"] = node_line_middle_3;
  const mesh_line_middle_3Geometry = endpoint_line_middle_3
    ? new THREE.CylinderGeometry(endpoint_line_middle_3.endRadius, endpoint_line_middle_3.baseRadius, endpoint_line_middle_3.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_line_middle_3 = new THREE.Mesh(
    mesh_line_middle_3Geometry,
    materialMap["fabric"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_line_middle_3.name = "Middle row \u2014 HOW TO CREATE A LESSON PLAN";
  if (endpoint_line_middle_3) {
    mesh_line_middle_3.position.copy(endpoint_line_middle_3.midpoint);
    mesh_line_middle_3.quaternion.copy(endpoint_line_middle_3.quaternion);
  }
  mesh_line_middle_3.castShadow = options.castShadow ?? true;
  mesh_line_middle_3.receiveShadow = options.receiveShadow ?? true;
  mesh_line_middle_3.userData.sculptComponent = {"id": "line-middle", "name": "Middle row — HOW TO CREATE A LESSON PLAN", "level": "meso", "role": "row", "importance": 1.0, "confidence": 0.99, "primitive": "instanced-cluster", "topologyClass": "material-only", "topologyRationale": "A separate row pivot preserves the long line's spacing and lets the row move independently during the ad.", "parent": "typography-layout", "dimensions": {"width": 5.4, "height": 0.67, "depth": 0.34, "units": "relative", "confidence": 0.92}, "transform": {"position": [0, 0.0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "row-middle", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.97}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": true, "twist": true, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "compound-glyph-row", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "row-middle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "fabric"}}, "materialLayers": [], "localFeatures": [{"id": "middleRowText", "kind": "linework", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "notes": "Longest line; tight spacing must stay readable."}, "evidenceRefs": ["full-object"], "fidelityTier": "blockout"};
  node_line_middle_3.add(mesh_line_middle_3);
  meshes["line-middle"] = mesh_line_middle_3;
  colliders["line-middle"] = {"type": "compound-glyph-row", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false};
  destructionGroups["row-middle"] ??= [];
  destructionGroups["row-middle"].push(node_line_middle_3);

  const attachment_line_bottom_4 = null;
  const endpoint_line_bottom_4 = makeAttachmentEndpoint(attachment_line_bottom_4);
  const node_line_bottom_4 = new THREE.Group();
  node_line_bottom_4.name = "Bottom row \u2014 IN 30 SECONDS__pivot";
  if (endpoint_line_bottom_4) {
    node_line_bottom_4.position.copy(endpoint_line_bottom_4.start);
    node_line_bottom_4.rotation.set(0, 0, 0);
    node_line_bottom_4.scale.set(1, 1, 1);
  } else {
    node_line_bottom_4.position.set(0.0, -0.86, 0.0);
    node_line_bottom_4.rotation.set(0.0, 0.0, 0.0);
    node_line_bottom_4.scale.set(1.0, 1.0, 1.0);
  }
  node_line_bottom_4.userData.sculptComponent = {"id": "line-bottom", "name": "Bottom row — IN 30 SECONDS", "level": "meso", "role": "row", "importance": 1.0, "confidence": 0.99, "primitive": "instanced-cluster", "topologyClass": "material-only", "topologyRationale": "A centered shorter row pivot preserves the reference's vertical hierarchy and supports a separate reveal beat.", "parent": "typography-layout", "dimensions": {"width": 4.1, "height": 0.72, "depth": 0.34, "units": "relative", "confidence": 0.92}, "transform": {"position": [0, -0.86, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "row-bottom", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.97}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": true, "twist": true, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "compound-glyph-row", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "row-bottom", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "fabric"}}, "materialLayers": [], "localFeatures": [{"id": "bottomRowText", "kind": "linework", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "notes": "Centered shorter line with visible numeral group."}, "evidenceRefs": ["full-object"], "fidelityTier": "blockout"};
  node_line_bottom_4.userData.actionProfile = {"animationRole": "row-bottom", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.97}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": true, "twist": true, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "compound-glyph-row", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "row-bottom", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "fabric"}};
  (nodes["typography-layout"] ?? root).add(node_line_bottom_4);
  nodes["line-bottom"] = node_line_bottom_4;
  const mesh_line_bottom_4Geometry = endpoint_line_bottom_4
    ? new THREE.CylinderGeometry(endpoint_line_bottom_4.endRadius, endpoint_line_bottom_4.baseRadius, endpoint_line_bottom_4.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_line_bottom_4 = new THREE.Mesh(
    mesh_line_bottom_4Geometry,
    materialMap["fabric"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_line_bottom_4.name = "Bottom row \u2014 IN 30 SECONDS";
  if (endpoint_line_bottom_4) {
    mesh_line_bottom_4.position.copy(endpoint_line_bottom_4.midpoint);
    mesh_line_bottom_4.quaternion.copy(endpoint_line_bottom_4.quaternion);
  }
  mesh_line_bottom_4.castShadow = options.castShadow ?? true;
  mesh_line_bottom_4.receiveShadow = options.receiveShadow ?? true;
  mesh_line_bottom_4.userData.sculptComponent = {"id": "line-bottom", "name": "Bottom row — IN 30 SECONDS", "level": "meso", "role": "row", "importance": 1.0, "confidence": 0.99, "primitive": "instanced-cluster", "topologyClass": "material-only", "topologyRationale": "A centered shorter row pivot preserves the reference's vertical hierarchy and supports a separate reveal beat.", "parent": "typography-layout", "dimensions": {"width": 4.1, "height": 0.72, "depth": 0.34, "units": "relative", "confidence": 0.92}, "transform": {"position": [0, -0.86, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "row-bottom", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.97}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": true, "twist": true, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "compound-glyph-row", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "row-bottom", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "fabric"}}, "materialLayers": [], "localFeatures": [{"id": "bottomRowText", "kind": "linework", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "notes": "Centered shorter line with visible numeral group."}, "evidenceRefs": ["full-object"], "fidelityTier": "blockout"};
  node_line_bottom_4.add(mesh_line_bottom_4);
  meshes["line-bottom"] = mesh_line_bottom_4;
  colliders["line-bottom"] = {"type": "compound-glyph-row", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false};
  destructionGroups["row-bottom"] ??= [];
  destructionGroups["row-bottom"].push(node_line_bottom_4);

  const attachment_glyph_template_5 = null;
  const endpoint_glyph_template_5 = makeAttachmentEndpoint(attachment_glyph_template_5);
  const node_glyph_template_5 = new THREE.Group();
  node_glyph_template_5.name = "Reusable padded glyph template__pivot";
  if (endpoint_glyph_template_5) {
    node_glyph_template_5.position.copy(endpoint_glyph_template_5.start);
    node_glyph_template_5.rotation.set(0, 0, 0);
    node_glyph_template_5.scale.set(1, 1, 1);
  } else {
    node_glyph_template_5.position.set(0.0, 0.0, 0.0);
    node_glyph_template_5.rotation.set(0.0, 0.0, 0.0);
    node_glyph_template_5.scale.set(1.0, 1.0, 1.0);
  }
  node_glyph_template_5.userData.sculptComponent = {"id": "glyph-template", "name": "Reusable padded glyph template", "level": "meso", "role": "glyph", "importance": 1.0, "confidence": 0.95, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Each letter is an extruded 2D glyph profile with real counters, rounded perimeter bevels, and a shallow padded side wall.", "parent": "typography-layout", "dimensions": {"width": 0.46, "height": 0.78, "depth": 0.24, "units": "relative", "confidence": 0.86}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "rounded extruded glyph with inflated bevel transition", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.07, "segments": 6}, "deformationStack": ["pillow-inflate", "soft-edge-normal"], "uvStrategy": "generated object-local coordinates", "normalStrategy": "smooth front and side normals with independent textile normal"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 63, 30, 1.0)", "secondaryAlbedo": "rgba(241, 184, 80, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "mode": "per-glyph-palette", "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(255, 110, 70, 1.0)"}, {"position": 0.5, "color": "rgba(199, 63, 30, 1.0)"}, {"position": 1.0, "color": "rgba(110, 30, 20, 1.0)"}]}, "notes": "Use a palette slot per glyph rather than one averaged material."}, "actionProfile": {"animationRole": "detachable-glyph-template", "pivot": {"mode": "glyph-center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.94}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": true, "twist": true, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "glyphOrigin", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "rounded-glyph", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glyph-detachables", "seamRefs": ["perimeter-stitch"], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "fabric"}}, "material": "fabric", "materialLayers": ["fabric", "seam"], "localFeatures": [{"id": "paddedExtrusion", "kind": "bevel", "geometryEffect": "inflated extrude and bevel", "depth": 0.24, "radius": 0.07, "segments": 6, "evidenceRefs": ["full-object"]}, {"id": "realCounters", "kind": "hole", "geometryEffect": "real glyph path holes", "evidenceRefs": ["full-object"]}, {"id": "perimeter-stitch", "kind": "stitch", "geometryEffect": "raised contour tube following glyph path", "evidenceRefs": ["full-object"]}, {"id": "glyphOrigin", "kind": "contour", "geometryEffect": "stable local pivot at glyph center", "evidenceRefs": ["full-object"]}, {"id": "colorSlot", "kind": "linework", "geometryEffect": "per-instance palette index", "evidenceRefs": ["full-object"]}, {"id": "collisionProxy", "kind": "contour", "geometryEffect": "rounded compound collider proxy", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.78, "microRoughness": 0.12, "bumpAmplitude": 0.22, "normalPattern": "short-pile textile", "displacementPattern": "subtle padded front inflation", "occlusionPattern": "seam and counter cavity", "edgeWearPattern": "compressed darker seam edge", "notes": "The template is instantiated for every glyph and punctuation mark."}, "evidenceRefs": ["full-object"], "fidelityTier": "form-refinement"};
  node_glyph_template_5.userData.actionProfile = {"animationRole": "detachable-glyph-template", "pivot": {"mode": "glyph-center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.94}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": true, "twist": true, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "glyphOrigin", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "rounded-glyph", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glyph-detachables", "seamRefs": ["perimeter-stitch"], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "fabric"}};
  (nodes["typography-layout"] ?? root).add(node_glyph_template_5);
  nodes["glyph-template"] = node_glyph_template_5;
  const mesh_glyph_template_5Geometry = endpoint_glyph_template_5
    ? new THREE.CylinderGeometry(endpoint_glyph_template_5.endRadius, endpoint_glyph_template_5.baseRadius, endpoint_glyph_template_5.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], "depth": 0.1});
  const mesh_glyph_template_5 = new THREE.Mesh(
    mesh_glyph_template_5Geometry,
    materialMap["fabric"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glyph_template_5.name = "Reusable padded glyph template";
  if (endpoint_glyph_template_5) {
    mesh_glyph_template_5.position.copy(endpoint_glyph_template_5.midpoint);
    mesh_glyph_template_5.quaternion.copy(endpoint_glyph_template_5.quaternion);
  }
  mesh_glyph_template_5.castShadow = options.castShadow ?? true;
  mesh_glyph_template_5.receiveShadow = options.receiveShadow ?? true;
  mesh_glyph_template_5.userData.sculptComponent = {"id": "glyph-template", "name": "Reusable padded glyph template", "level": "meso", "role": "glyph", "importance": 1.0, "confidence": 0.95, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Each letter is an extruded 2D glyph profile with real counters, rounded perimeter bevels, and a shallow padded side wall.", "parent": "typography-layout", "dimensions": {"width": 0.46, "height": 0.78, "depth": 0.24, "units": "relative", "confidence": 0.86}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "rounded extruded glyph with inflated bevel transition", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.07, "segments": 6}, "deformationStack": ["pillow-inflate", "soft-edge-normal"], "uvStrategy": "generated object-local coordinates", "normalStrategy": "smooth front and side normals with independent textile normal"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 63, 30, 1.0)", "secondaryAlbedo": "rgba(241, 184, 80, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "mode": "per-glyph-palette", "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(255, 110, 70, 1.0)"}, {"position": 0.5, "color": "rgba(199, 63, 30, 1.0)"}, {"position": 1.0, "color": "rgba(110, 30, 20, 1.0)"}]}, "notes": "Use a palette slot per glyph rather than one averaged material."}, "actionProfile": {"animationRole": "detachable-glyph-template", "pivot": {"mode": "glyph-center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.94}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": true, "twist": true, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "glyphOrigin", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "rounded-glyph", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glyph-detachables", "seamRefs": ["perimeter-stitch"], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "fabric"}}, "material": "fabric", "materialLayers": ["fabric", "seam"], "localFeatures": [{"id": "paddedExtrusion", "kind": "bevel", "geometryEffect": "inflated extrude and bevel", "depth": 0.24, "radius": 0.07, "segments": 6, "evidenceRefs": ["full-object"]}, {"id": "realCounters", "kind": "hole", "geometryEffect": "real glyph path holes", "evidenceRefs": ["full-object"]}, {"id": "perimeter-stitch", "kind": "stitch", "geometryEffect": "raised contour tube following glyph path", "evidenceRefs": ["full-object"]}, {"id": "glyphOrigin", "kind": "contour", "geometryEffect": "stable local pivot at glyph center", "evidenceRefs": ["full-object"]}, {"id": "colorSlot", "kind": "linework", "geometryEffect": "per-instance palette index", "evidenceRefs": ["full-object"]}, {"id": "collisionProxy", "kind": "contour", "geometryEffect": "rounded compound collider proxy", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.78, "microRoughness": 0.12, "bumpAmplitude": 0.22, "normalPattern": "short-pile textile", "displacementPattern": "subtle padded front inflation", "occlusionPattern": "seam and counter cavity", "edgeWearPattern": "compressed darker seam edge", "notes": "The template is instantiated for every glyph and punctuation mark."}, "evidenceRefs": ["full-object"], "fidelityTier": "form-refinement"};
  node_glyph_template_5.add(mesh_glyph_template_5);
  meshes["glyph-template"] = mesh_glyph_template_5;
  colliders["glyph-template"] = {"type": "rounded-glyph", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false};
  destructionGroups["glyph-detachables"] ??= [];
  destructionGroups["glyph-detachables"].push(node_glyph_template_5);
  const socket_glyph_template_glyphOrigin_0 = new THREE.Object3D();
  socket_glyph_template_glyphOrigin_0.name = "glyphOrigin";
  socket_glyph_template_glyphOrigin_0.position.set(0.0, 0.0, 0.0);
  socket_glyph_template_glyphOrigin_0.rotation.set(0.0, 0.0, 0.0);
  socket_glyph_template_glyphOrigin_0.userData.socket = {"id": "glyphOrigin", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]};
  node_glyph_template_5.add(socket_glyph_template_glyphOrigin_0);
  sockets["glyph-template:glyphOrigin"] = socket_glyph_template_glyphOrigin_0;

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim light", "environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow"]}};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createPlushLessonPlanTypographyLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Plush Lesson Plan Typography look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = ["Key light: broad warm source from upper camera-left, producing soft highlights on pile and darker right-side seam response.", "Fill light: low-intensity warm ambient fill keeps counters readable without flattening relief.", "Rim/environment light: subtle neutral lift on upper side walls separates colorful glyphs from the cream background.", "Exposure and tone mapping: neutral exposure with ACES/filmic response for saturated textile colors.", "Contact shadow: soft AO/contact shadow directly below and between letters grounds each independent prop."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim light", "environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow"]}};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createPlushLessonPlanTypographyEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function framePlushLessonPlanTypographyCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createPlushLessonPlanTypographyPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configurePlushLessonPlanTypographyRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createPlushLessonPlanTypographyInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
