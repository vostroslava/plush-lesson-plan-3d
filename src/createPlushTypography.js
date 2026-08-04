import * as THREE from 'three';
import * as opentype from 'opentype.js';
import fontUrl from './assets/ArialRoundedBold.ttf?url';

const fontPromise = fetch(fontUrl)
  .then((response) => response.arrayBuffer())
  .then((buffer) => opentype.parse(buffer));

const PALETTE = [
  '#C73F1E', '#E87031', '#F1B850', '#79A84B', '#4F91C9', '#8B5AAE', '#E8839E', '#37B8B2',
];
const SOFT_REST_SCALE = new THREE.Vector3(1, 1, 1);
const SOFT_REST_ROTATION = new THREE.Vector3(0, 0, 0);

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makePlushTexture(baseColor, seed, options = {}) {
  const size = options.size ?? 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const color = options.neutral ? new THREE.Color(0xffffff) : new THREE.Color(baseColor);
  const rand = (x, y) => {
    let value = Math.imul(x + seed * 31, 374761393) ^ Math.imul(y + seed * 17, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const fine = rand(x, y) - 0.5;
      const broad = rand(Math.floor(x / 12), Math.floor(y / 12)) - 0.5;
      const fiberA = Math.sin((x * 0.93 + y * 0.17) + seed * 0.47) * 0.5;
      const fiberB = Math.sin((x * 0.19 - y * 1.07) + seed * 1.31) * 0.28;
      const shade = 1 + fine * 0.13 + broad * 0.09 + (fiberA + fiberB) * 0.035;
      const i = (y * size + x) * 4;
      image.data[i] = Math.max(0, Math.min(255, Math.round(color.r * 255 * shade)));
      image.data[i + 1] = Math.max(0, Math.min(255, Math.round(color.g * 255 * shade)));
      image.data[i + 2] = Math.max(0, Math.min(255, Math.round(color.b * 255 * shade)));
      image.data[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.8, 1.8);
  texture.anisotropy = 8;
  return texture;
}

function makeBumpTexture(seed, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let value = Math.imul(x + seed * 13, 1103515245) ^ Math.imul(y + seed * 7, 12345);
      value = Math.imul(value ^ (value >>> 16), 2246822519);
      const random = ((value >>> 0) / 4294967295) - 0.5;
      const ridgeA = Math.sin((x * 1.12 + y * 0.21) + seed * 0.83);
      const ridgeB = Math.sin((x * 0.24 - y * 1.38) + seed * 1.19);
      const tuft = ridgeA * 0.42 + ridgeB * 0.25 + random * 0.48;
      const noise = 128 + tuft * 64;
      const i = (y * size + x) * 4;
      image.data[i] = noise;
      image.data[i + 1] = noise;
      image.data[i + 2] = noise;
      image.data[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4.2, 4.2);
  return texture;
}

function makeRoughnessTexture(seed, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let value = Math.imul(x + seed * 19, 1597334677) ^ Math.imul(y + seed * 23, 3812015801);
      value = Math.imul(value ^ (value >>> 15), 2246822519);
      const random = ((value >>> 0) / 4294967295) - 0.5;
      const fiber = Math.sin((x * 0.83 + y * 0.28) + seed * 0.61) * 0.5;
      const roughness = Math.max(0, Math.min(255, Math.round(222 + (random * 18) + fiber * 10)));
      const i = (y * size + x) * 4;
      image.data[i] = roughness;
      image.data[i + 1] = roughness;
      image.data[i + 2] = roughness;
      image.data[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4.0, 4.0);
  texture.anisotropy = 8;
  return texture;
}

function addPileShader(material, color, seed, seam) {
  material.userData.plushColor = color;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPlushColor = { value: new THREE.Color(material.userData.plushColor ?? color) };
    shader.uniforms.uPlushSeed = { value: seed % 997 };
    shader.uniforms.uPileAmount = { value: seam ? 0.45 : 1.0 };
    shader.uniforms.uPlushTime = { value: 0 };
    shader.uniforms.uPlushImpact = { value: 0 };
    shader.uniforms.uPlushBend = { value: 0 };
    shader.uniforms.uPlushDimple = { value: 0 };
    shader.uniforms.uPlushDimpleOrigin = { value: new THREE.Vector2(0, -0.12) };
    shader.uniforms.uPlushDeformSize = { value: new THREE.Vector2(0.8, 0.9) };
    material.userData.plushShader = shader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      uniform float uPlushBend;
      uniform float uPlushDimple;
      uniform vec2 uPlushDimpleOrigin;
      uniform vec2 uPlushDeformSize;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
      float plushNormalX = (position.x - uPlushDimpleOrigin.x) / max(uPlushDeformSize.x, 0.001);
      float plushNormalY = (position.y - uPlushDimpleOrigin.y) / max(uPlushDeformSize.y, 0.001);
      float plushNormalFalloff = exp(-(plushNormalX * plushNormalX + plushNormalY * plushNormalY) * 2.6);
      objectNormal.x += uPlushBend * plushNormalY * 0.10;
      objectNormal.z += uPlushDimple * plushNormalFalloff * 0.18;
      objectNormal = normalize(objectNormal);`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float plushDeformX = (position.x - uPlushDimpleOrigin.x) / max(uPlushDeformSize.x, 0.001);
      float plushDeformY = (position.y - uPlushDimpleOrigin.y) / max(uPlushDeformSize.y, 0.001);
      float plushDimpleFalloff = exp(-(plushDeformX * plushDeformX + plushDeformY * plushDeformY) * 2.6);
      float plushFrontWeight = smoothstep(0.035, 0.15, transformed.z);
      transformed.x += uPlushBend * plushDeformY * uPlushDeformSize.x * 0.06;
      transformed.y += uPlushBend * plushDeformX * uPlushDeformSize.y * 0.025;
      transformed.z -= uPlushDimple * plushDimpleFalloff * (0.42 + plushFrontWeight * 0.58);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      uniform vec3 uPlushColor;
      uniform float uPlushSeed;
      uniform float uPileAmount;
      uniform float uPlushTime;
      uniform float uPlushImpact;
      float plushHash(vec2 p) {
        return fract(sin(dot(p + uPlushSeed, vec2(12.9898, 78.233))) * 43758.5453);
      }
      float plushFiber(vec2 p) {
        float a = sin(p.x + sin(p.y * 0.31 + uPlushSeed + uPlushTime * 0.16) * 1.7);
        float b = sin(p.y * 1.41 + sin(p.x * 0.23 - uPlushTime * 0.11) * 2.1);
        float grain = plushHash(floor(p * 0.72)) - 0.5;
        return a * 0.24 + b * 0.18 + grain * 0.58;
      }`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      float plushGrain = plushFiber(vMapUv * 118.0);
      float plushEdge = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 4.0);
      float plushImpact = smoothstep(0.0, 1.0, uPlushImpact);
      diffuseColor.rgb *= 0.975 + plushGrain * (0.115 + plushImpact * 0.035) * uPileAmount;
      diffuseColor.rgb += uPlushColor * plushEdge * (0.045 + plushImpact * 0.018) * uPileAmount;`,
    );
  };
  material.customProgramCacheKey = () => `plush-pile-${seam ? 'seam' : 'body'}`;
  return material;
}

function setMaterialPlushColor(material, color) {
  if (!material?.userData?.plushEditableColor) return;
  const targetColor = material.userData.plushColorMode === 'highlight'
    ? new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.24)
    : new THREE.Color(color);
  material.userData.plushColor = targetColor;
  material.color.set(targetColor);
  material.sheenColor?.set(targetColor);
  material.userData.plushShader?.uniforms?.uPlushColor?.value?.set(targetColor);
}

function makeMaterial(color, seed, seam = false, options = {}) {
  const editableColor = options.editableColor === true;
  const textureSize = options.textureSize ?? 256;
  const material = new THREE.MeshPhysicalMaterial({
    map: makePlushTexture(color, seed, { size: textureSize, neutral: editableColor }),
    bumpMap: makeBumpTexture(seed + 11, textureSize),
    roughnessMap: makeRoughnessTexture(seed + 29, textureSize),
    bumpScale: seam ? 0.032 : 0.072,
    color: editableColor ? color : 0xffffff,
    roughness: seam ? 0.86 : 0.93,
    metalness: 0,
    clearcoat: 0,
    sheen: seam ? 0.2 : 0.42,
    sheenColor: new THREE.Color(color),
    sheenRoughness: 0.88,
    specularIntensity: 0.16,
    side: THREE.DoubleSide,
  });
  material.userData.plushEditableColor = editableColor;
  material.userData.plushRole = options.role ?? (seam ? 'seam' : 'body');
  return addPileShader(material, color, seed, seam);
}

function makeGlyphGeometry(character, font, options = {}) {
  const size = options.size ?? 0.72;
  const path = font.charToGlyph(character).getPath(0, 0, size * 1000);
  const shapePath = new THREE.ShapePath();
  for (const command of path.commands) {
    if (command.type === 'M') shapePath.moveTo(command.x / 1000, -command.y / 1000);
    else if (command.type === 'L') shapePath.lineTo(command.x / 1000, -command.y / 1000);
    else if (command.type === 'C') shapePath.bezierCurveTo(command.x1 / 1000, -command.y1 / 1000, command.x2 / 1000, -command.y2 / 1000, command.x / 1000, -command.y / 1000);
    else if (command.type === 'Q') shapePath.quadraticCurveTo(command.x1 / 1000, -command.y1 / 1000, command.x / 1000, -command.y / 1000);
    else if (command.type === 'Z') shapePath.closePath();
  }
  const shapes = shapePath.toShapes(false);
  return new THREE.ExtrudeGeometry(shapes, {
    depth: options.depth ?? 0.22,
    curveSegments: options.curveSegments ?? 16,
    bevelEnabled: true,
    bevelThickness: options.bevelThickness ?? 0.055,
    bevelSize: options.bevelSize ?? 0.052,
    bevelOffset: 0,
    bevelSegments: options.bevelSegments ?? 8,
  });
}

function sampleGlyphOutline(character, font, size) {
  const path = font.charToGlyph(character).getPath(0, 0, size * 1000);
  const segments = [];
  let points = [];
  const point = (x, y, z = 0) => new THREE.Vector3(x / 1000, -y / 1000, z);
  const flush = () => {
    if (points.length > 2) segments.push(points);
    points = [];
  };
  const last = () => points[points.length - 1] ?? new THREE.Vector3();
  for (const command of path.commands) {
    if (command.type === 'M') {
      flush();
      points.push(point(command.x, command.y));
    } else if (command.type === 'L') {
      points.push(point(command.x, command.y));
    } else if (command.type === 'C') {
      const start = last();
      const startX = start.x;
      const startY = -start.y;
      for (let step = 1; step <= 12; step += 1) {
        const t = step / 12;
        const inverse = 1 - t;
        const x = inverse ** 3 * startX * 1000
          + 3 * inverse ** 2 * t * command.x1
          + 3 * inverse * t ** 2 * command.x2
          + t ** 3 * command.x;
        const y = inverse ** 3 * startY * 1000
          + 3 * inverse ** 2 * t * command.y1
          + 3 * inverse * t ** 2 * command.y2
          + t ** 3 * command.y;
        points.push(point(x, y));
      }
    } else if (command.type === 'Q') {
      const start = last();
      const startX = start.x;
      const startY = -start.y;
      for (let step = 1; step <= 10; step += 1) {
        const t = step / 10;
        const inverse = 1 - t;
        const x = inverse ** 2 * startX * 1000 + 2 * inverse * t * command.x1 + t ** 2 * command.x;
        const y = inverse ** 2 * startY * 1000 + 2 * inverse * t * command.y1 + t ** 2 * command.y;
        points.push(point(x, y));
      }
    } else if (command.type === 'Z') {
      if (points.length > 1) points.push(points[0].clone());
      flush();
    }
  }
  flush();
  return segments;
}

function makeGlyphDetail(character, font, size, depth, color, options = {}) {
  const segments = sampleGlyphOutline(character, font, size);
  const group = new THREE.Group();
  group.name = 'detail.stitches-and-fibers';
  const detailMaterials = [];
  const stitchMaterial = new THREE.LineDashedMaterial({
    color,
    transparent: true,
    opacity: 0.86,
    dashSize: 0.045,
    gapSize: 0.028,
    depthTest: true,
  });
  stitchMaterial.userData.plushEditableColor = options.editableColor === true;
  stitchMaterial.userData.plushRole = 'seam';
  detailMaterials.push(stitchMaterial);
  const pipingMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.24),
    roughness: 0.66,
    metalness: 0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.54,
    sheen: 0.20,
    sheenColor: new THREE.Color(color),
  });
  pipingMaterial.userData.plushEditableColor = options.editableColor === true;
  pipingMaterial.userData.plushRole = 'seam';
  pipingMaterial.userData.plushColorMode = 'highlight';
  detailMaterials.push(pipingMaterial);
  for (const segment of segments) {
    const geometry = new THREE.BufferGeometry().setFromPoints(segment);
    const line = new THREE.Line(geometry, stitchMaterial);
    line.position.z = depth + 0.052;
    line.computeLineDistances();
    line.name = 'stitch-line';
    group.add(line);
    if (segment.length > 3) {
      const curve = new THREE.CatmullRomCurve3(segment, false, 'centripetal');
      const pipingGeometry = new THREE.TubeGeometry(curve, Math.max(12, segment.length * 2), 0.016, 6, false);
      const piping = new THREE.Mesh(pipingGeometry, pipingMaterial);
      piping.position.z = depth + 0.058;
      piping.name = 'seam-piping';
      piping.castShadow = true;
      piping.receiveShadow = true;
      group.add(piping);
    }
  }

  const fringePoints = [];
  const seed = hashString(`${character}:${size}:${depth}`);
  segments.forEach((segment, segmentIndex) => {
    for (let index = 0; index < segment.length; index += 2) {
      const current = segment[index];
      const next = segment[(index + 1) % segment.length] ?? current;
      const tangent = next.clone().sub(current).normalize();
      const normal = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();
      for (let tuft = 0; tuft < 2; tuft += 1) {
        const value = hashString(`${seed}:${segmentIndex}:${index}:${tuft}`);
        const jitter = ((value % 997) / 997 - 0.5) * 0.020;
        fringePoints.push(
          current.x + normal.x * (0.009 + tuft * 0.012) + tangent.x * jitter,
          current.y + normal.y * (0.009 + tuft * 0.012) + tangent.y * jitter,
          depth + 0.034 + ((value >>> 8) % 100) / 100000,
        );
      }
    }
  });
  if (fringePoints.length > 0) {
    const fringeGeometry = new THREE.BufferGeometry();
    fringeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fringePoints, 3));
    const fringeMaterial = new THREE.PointsMaterial({
      color,
      size: 0.018,
      transparent: true,
      opacity: 0.38,
      sizeAttenuation: true,
      depthTest: true,
    });
    fringeMaterial.userData.plushEditableColor = options.editableColor === true;
    fringeMaterial.userData.plushRole = 'seam';
    detailMaterials.push(fringeMaterial);
    const fringe = new THREE.Points(fringeGeometry, fringeMaterial);
    fringe.name = 'edge-fiber-fringe';
    group.add(fringe);
  }

  const stitchTransforms = [];
  for (const segment of segments) {
    for (let index = 0; index < segment.length - 1; index += 2) {
      const current = segment[index];
      const next = segment[index + 1];
      const tangent = next.clone().sub(current);
      if (tangent.lengthSq() < 0.000001) continue;
      tangent.normalize();
      stitchTransforms.push({
        position: current.clone().lerp(next, 0.5).setZ(depth + 0.066),
        quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), tangent),
      });
    }
  }
  if (stitchTransforms.length > 0) {
    const stitchGeometry = new THREE.SphereGeometry(1, 8, 5);
    const raisedStitchMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.24),
      roughness: 0.58,
      metalness: 0,
      clearcoat: 0.18,
      clearcoatRoughness: 0.48,
      sheen: 0.25,
      sheenColor: new THREE.Color(color),
      transparent: true,
      opacity: 0.94,
    });
    raisedStitchMaterial.userData.plushEditableColor = options.editableColor === true;
    raisedStitchMaterial.userData.plushRole = 'seam';
    raisedStitchMaterial.userData.plushColorMode = 'highlight';
    detailMaterials.push(raisedStitchMaterial);
    const raisedStitches = new THREE.InstancedMesh(stitchGeometry, raisedStitchMaterial, stitchTransforms.length);
    const matrix = new THREE.Matrix4();
    for (const [index, transform] of stitchTransforms.entries()) {
      matrix.compose(transform.position, transform.quaternion, new THREE.Vector3(0.050, 0.015, 0.009));
      raisedStitches.setMatrixAt(index, matrix);
    }
    raisedStitches.instanceMatrix.needsUpdate = true;
    raisedStitches.computeBoundingSphere();
    raisedStitches.frustumCulled = false;
    raisedStitches.name = 'raised-stitch-beads';
    raisedStitches.castShadow = true;
    raisedStitches.receiveShadow = true;
    group.add(raisedStitches);
  }
  return { group, materials: detailMaterials };
}

function attachGlyphStyleApi(glyph, color, materials, options = {}) {
  const deformBounds = new THREE.Box3();
  glyph.traverse((node) => {
    if (!node.isMesh || node.isInstancedMesh || !node.geometry?.attributes?.position) return;
    node.geometry.computeBoundingBox();
    node.updateMatrix();
    const bounds = node.geometry.boundingBox.clone().applyMatrix4(node.matrix);
    deformBounds.union(bounds);
  });
  glyph.userData.style = {
    color,
    scale: 1,
    depth: 1,
    editableColor: options.editableColor === true,
  };
  const softBody = {
    softness: 0.74,
    stiffness: 132,
    damping: 18,
    scale: new THREE.Vector3(1, 1, 1),
    targetScale: new THREE.Vector3(1, 1, 1),
    scaleVelocity: new THREE.Vector3(),
    scaleDelta: new THREE.Vector3(),
    rotation: new THREE.Vector3(),
    targetRotation: new THREE.Vector3(),
    rotationVelocity: new THREE.Vector3(),
    rotationDelta: new THREE.Vector3(),
    bend: 0,
    targetBend: 0,
    bendVelocity: 0,
    dimple: 0,
    targetDimple: 0,
    dimpleVelocity: 0,
    deformOrigin: new THREE.Vector2(0, -0.12),
    deformSize: new THREE.Vector2(0.8, 0.9),
    baseQuaternion: new THREE.Quaternion(),
    softQuaternion: new THREE.Quaternion(),
    impact: 0,
    pulse: 0,
    time: (hashString(`${glyph.name}:soft-body`) % 1000) / 100,
    phase: (hashString(`${glyph.name}:phase`) % 628) / 100,
  };
  if (!deformBounds.isEmpty()) {
    const deformSize = deformBounds.getSize(new THREE.Vector3());
    const deformCenter = deformBounds.getCenter(new THREE.Vector3());
    softBody.deformSize.set(Math.max(0.24, deformSize.x), Math.max(0.32, deformSize.y));
    softBody.deformOrigin.set(deformCenter.x, deformBounds.min.y + deformSize.y * 0.36);
  }
  glyph.userData.softBody = softBody;

  const applySoftTransform = () => {
    const style = glyph.userData.style;
    glyph.scale.set(
      style.scale * softBody.scale.x,
      style.scale * softBody.scale.y,
      style.scale * style.depth * softBody.scale.z,
    );
    softBody.softQuaternion.setFromEuler(new THREE.Euler(
      softBody.rotation.x,
      softBody.rotation.y,
      softBody.rotation.z,
    ));
    glyph.quaternion.copy(softBody.baseQuaternion).multiply(softBody.softQuaternion);
  };

  const applySoftShaderState = () => {
    for (const material of materials) {
      const shader = material?.userData?.plushShader;
      if (!shader) continue;
      shader.uniforms.uPlushTime.value = softBody.time + softBody.phase;
      shader.uniforms.uPlushImpact.value = softBody.impact;
      shader.uniforms.uPlushBend.value = softBody.bend;
      shader.uniforms.uPlushDimple.value = softBody.dimple;
      shader.uniforms.uPlushDimpleOrigin.value.copy(softBody.deformOrigin);
      shader.uniforms.uPlushDeformSize.value.copy(softBody.deformSize);
    }
  };

  glyph.userData.setSoftness = (value) => {
    const softness = Math.max(0, Math.min(1, Number(value) || 0));
    softBody.softness = softness;
    softBody.stiffness = THREE.MathUtils.lerp(220, 72, softness);
    softBody.damping = THREE.MathUtils.lerp(27, 11, softness);
    if (glyph.userData.physics?.softBody) {
      glyph.userData.physics.softBody.softness = softness;
      glyph.userData.physics.softBody.compression = THREE.MathUtils.lerp(0.18, 0.36, softness);
      glyph.userData.physics.softBody.stretch = THREE.MathUtils.lerp(0.12, 0.30, softness);
      glyph.userData.physics.softBody.recovery = THREE.MathUtils.lerp(0.96, 0.74, softness);
    }
  };

  glyph.userData.setSoftBaseQuaternion = (quaternion) => {
    if (quaternion?.isQuaternion) softBody.baseQuaternion.copy(quaternion);
    applySoftTransform();
  };

  glyph.userData.triggerSquash = (strength = 1, direction = 1) => {
    const amount = Math.max(0, Math.min(1.35, Number(strength) || 0));
    const sign = Number(direction) < 0 ? -1 : 1;
    softBody.targetScale.set(
      1 + amount * 0.22,
      1 - amount * 0.30,
      1 + amount * 0.13,
    );
    softBody.targetRotation.set(
      amount * 0.035 * sign,
      amount * 0.055 * sign,
      amount * 0.09 * sign,
    );
    softBody.targetBend = amount * 0.72 * sign;
    softBody.targetDimple = amount * 0.032;
    softBody.scaleVelocity.y -= amount * 0.22;
    softBody.impact = Math.max(softBody.impact, amount);
    softBody.pulse = Math.max(softBody.pulse, amount);
  };

  glyph.userData.resetSoftBody = () => {
    softBody.scale.set(1, 1, 1);
    softBody.targetScale.set(1, 1, 1);
    softBody.scaleVelocity.set(0, 0, 0);
    softBody.rotation.set(0, 0, 0);
    softBody.targetRotation.set(0, 0, 0);
    softBody.rotationVelocity.set(0, 0, 0);
    softBody.bend = 0;
    softBody.targetBend = 0;
    softBody.bendVelocity = 0;
    softBody.dimple = 0;
    softBody.targetDimple = 0;
    softBody.dimpleVelocity = 0;
    softBody.impact = 0;
    softBody.pulse = 0;
    applySoftTransform();
    applySoftShaderState();
  };

  glyph.userData.updateSoftBody = (delta, wind = 0) => {
    const dt = Math.max(0, Math.min(0.05, Number(delta) || 0));
    if (dt <= 0) return;
    softBody.time += dt;
    const returnRate = 10 + softBody.softness * 8;
    softBody.targetScale.lerp(SOFT_REST_SCALE, Math.min(1, dt * returnRate));
    softBody.targetRotation.lerp(SOFT_REST_ROTATION, Math.min(1, dt * (returnRate + 2)));
    softBody.targetBend *= Math.exp(-dt * (7.2 + softBody.softness * 2.4));
    softBody.targetDimple *= Math.exp(-dt * (8.0 + softBody.softness * 2.8));
    softBody.scaleDelta.copy(softBody.targetScale).sub(softBody.scale);
    softBody.scaleVelocity.addScaledVector(softBody.scaleDelta, softBody.stiffness * dt);
    softBody.scaleVelocity.multiplyScalar(Math.exp(-softBody.damping * dt));
    softBody.scale.addScaledVector(softBody.scaleVelocity, dt);
    softBody.rotationDelta.copy(softBody.targetRotation).sub(softBody.rotation);
    softBody.rotationVelocity.addScaledVector(softBody.rotationDelta, softBody.stiffness * 0.32 * dt);
    softBody.rotationVelocity.multiplyScalar(Math.exp(-softBody.damping * 0.82 * dt));
    softBody.rotation.addScaledVector(softBody.rotationVelocity, dt);
    const bendDelta = softBody.targetBend - softBody.bend;
    softBody.bendVelocity += bendDelta * softBody.stiffness * 0.20 * dt;
    softBody.bendVelocity *= Math.exp(-softBody.damping * 0.74 * dt);
    softBody.bend += softBody.bendVelocity * dt;
    const dimpleDelta = softBody.targetDimple - softBody.dimple;
    softBody.dimpleVelocity += dimpleDelta * softBody.stiffness * 0.24 * dt;
    softBody.dimpleVelocity *= Math.exp(-softBody.damping * 0.80 * dt);
    softBody.dimple += softBody.dimpleVelocity * dt;
    if (wind) {
      softBody.rotation.z += Math.sin(softBody.time * 1.7 + softBody.phase) * wind * dt;
      softBody.rotation.x += Math.cos(softBody.time * 1.3 + softBody.phase) * wind * 0.45 * dt;
    }
    softBody.impact *= Math.exp(-dt * 7.5);
    softBody.pulse *= Math.exp(-dt * 5.2);
    applySoftTransform();
    applySoftShaderState();
  };

  glyph.userData.setColor = (nextColor) => {
    const bodyColor = new THREE.Color(nextColor);
    const seamColor = bodyColor.clone().multiplyScalar(0.72);
    for (const material of materials) {
      setMaterialPlushColor(material, material.userData.plushRole === 'seam' ? seamColor : bodyColor);
    }
    glyph.userData.style.color = `#${bodyColor.getHexString()}`;
  };
  glyph.userData.setScale = (value) => {
    const scale = Math.max(0.35, Math.min(2.4, Number(value) || 1));
    glyph.userData.style.scale = scale;
    applySoftTransform();
  };
  glyph.userData.setDepth = (value) => {
    const depth = Math.max(0.45, Math.min(2.2, Number(value) || 1));
    glyph.userData.style.depth = depth;
    applySoftTransform();
  };
  glyph.userData.setSoftness(softBody.softness);
  applySoftTransform();
  return glyph;
}

function setGlyphPhysicsMetadata(glyph, boundingBox, zOffset = 0, massScale = 1) {
  const bounds = new THREE.Box3(
    new THREE.Vector3(boundingBox.min.x - 0.008, boundingBox.min.y - 0.008, boundingBox.min.z + zOffset - 0.008),
    new THREE.Vector3(boundingBox.max.x + 0.008, boundingBox.max.y + 0.008, boundingBox.max.z + zOffset + 0.008),
  );
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  glyph.userData.physics = {
    shape: 'cuboid',
    halfExtents: [size.x * 0.5, size.y * 0.5, size.z * 0.5],
    centerOffset: [center.x, center.y, center.z],
    mass: Math.max(0.25, size.x * size.y * size.z * 5.2 * massScale),
    friction: 0.86,
    restitution: 0.22,
    linearDamping: 0.36,
    angularDamping: 0.48,
    softBody: {
      enabled: true,
      model: 'spring-squash-stretch',
      softness: 0.74,
      compression: 0.30,
      stretch: 0.22,
      twist: 0.09,
      localDeformation: {
        bend: 'vertex-shell',
        dimple: 'front-surface-falloff',
        response: 'spring-driven',
      },
      recovery: 0.82,
      colliderPolicy: 'rigid-proxy-plus-visual-soft-body',
    },
  };
}

function addGlyph(row, character, font, x, size, paletteIndex, id, options = {}) {
  const glyph = new THREE.Group();
  glyph.name = `glyph.${id}`;
  glyph.position.set(x, options.y ?? 0, options.z ?? 0);
  glyph.userData = {
    character,
    actionReady: true,
    collider: 'rounded-glyph',
    fractureGroup: 'glyph-detachables',
    materialState: 'plush-fabric',
  };

  const seed = hashString(`${id}:${character}`);
  const color = PALETTE[paletteIndex % PALETTE.length];
  const seamColor = new THREE.Color(color).multiplyScalar(0.72);
  if (character === ':') {
    const dotMaterial = makeMaterial(color, seed, false, { editableColor: options.editableColor, textureSize: options.textureSize, role: 'body' });
    const dotSeamMaterial = makeMaterial(`#${seamColor.getHexString()}`, seed + 101, true, { editableColor: options.editableColor, textureSize: options.textureSize, role: 'seam' });
    for (const y of [-size * 0.16, size * 0.16]) {
      const seamDot = new THREE.Mesh(new THREE.SphereGeometry(size * 0.105, 24, 14), dotSeamMaterial);
      seamDot.name = `seam.${id}.${y}`;
      seamDot.scale.z = 0.68;
      seamDot.position.set(0, y, -0.012);
      seamDot.castShadow = true;
      glyph.add(seamDot);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(size * 0.09, 24, 14), dotMaterial);
      dot.name = `glyphMesh.${id}.${y}`;
      dot.scale.z = 0.72;
      dot.position.set(0, y, 0.012);
      dot.castShadow = true;
      dot.receiveShadow = true;
      glyph.add(dot);
    }
    setGlyphPhysicsMetadata(
      glyph,
      new THREE.Box3(
        new THREE.Vector3(-size * 0.115, -size * 0.27, -size * 0.09),
        new THREE.Vector3(size * 0.115, size * 0.27, size * 0.09),
      ),
      0,
      0.72,
    );
    attachGlyphStyleApi(glyph, color, [dotMaterial, dotSeamMaterial], options);
    row.add(glyph);
    return { glyph, width: size * 0.28 };
  }
  const seamGeometry = makeGlyphGeometry(character, font, {
    size,
    depth: options.depth ?? 0.22,
    bevelSize: (options.bevelSize ?? 0.052) + 0.006,
    bevelThickness: (options.bevelThickness ?? 0.055) + 0.004,
    curveSegments: options.curveSegments,
    bevelSegments: options.bevelSegments,
  });
  seamGeometry.computeBoundingBox();
  setGlyphPhysicsMetadata(glyph, seamGeometry.boundingBox, -0.012);
  const seamMaterial = makeMaterial(`#${seamColor.getHexString()}`, seed + 101, true, { editableColor: options.editableColor, textureSize: options.textureSize, role: 'seam' });
  const seam = new THREE.Mesh(seamGeometry, seamMaterial);
  seam.name = `seam.${id}`;
  seam.position.z = -0.012;
  seam.castShadow = true;
  seam.receiveShadow = true;
  glyph.add(seam);

  const geometry = makeGlyphGeometry(character, font, {
    size,
    depth: options.depth ?? 0.22,
    bevelSize: options.bevelSize,
    bevelThickness: options.bevelThickness,
    curveSegments: options.curveSegments,
    bevelSegments: options.bevelSegments,
  });
  geometry.computeBoundingBox();
  const bodyMaterial = makeMaterial(color, seed, false, { editableColor: options.editableColor, textureSize: options.textureSize, role: 'body' });
  const mesh = new THREE.Mesh(geometry, bodyMaterial);
  mesh.name = `glyphMesh.${id}`;
  mesh.position.set(0, 0, 0.012);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  glyph.add(mesh);
  const detailMaterials = [];
  if (options.stitching) {
    const detail = makeGlyphDetail(character, font, size, options.depth ?? 0.22, `#${seamColor.getHexString()}`, options);
    glyph.add(detail.group);
    detailMaterials.push(...detail.materials);
  }
  attachGlyphStyleApi(glyph, color, [bodyMaterial, seamMaterial, ...detailMaterials], options);
  row.add(glyph);
  return { glyph, width: geometry.boundingBox.max.x - geometry.boundingBox.min.x };
}

function addTextRow(parent, text, options, font) {
  const row = new THREE.Group();
  row.name = options.id;
  row.userData = { rowText: text, actionReady: true, collider: 'compound-glyph-row' };
  const size = options.size;
  const gap = options.gap;
  const entries = [];
  let totalWidth = 0;
  for (const character of text) {
    if (character === ' ') {
      entries.push({ character, width: 0 });
      totalWidth += gap + options.wordGap;
      continue;
    }
    if (character === ':') {
      const width = size * 0.28;
      entries.push({ character, width });
      totalWidth += width + gap;
      continue;
    }
    const width = (font.charToGlyph(character).advanceWidth / font.unitsPerEm) * size;
    entries.push({ character, width });
    totalWidth += width + gap;
  }
  totalWidth -= gap;
  let cursor = -totalWidth / 2;
  let glyphIndex = 0;
  entries.forEach(({ character, width }, index) => {
    const x = cursor - (character === ' ' ? 0.04 : 0);
    if (character === ' ') {
      cursor += gap + options.wordGap;
      return;
    }
    const id = `${options.id}.${index}`;
    const paletteIndex = options.paletteSequence?.[glyphIndex] ?? (options.paletteOffset + glyphIndex);
    const glyph = addGlyph(row, character, font, x, size, paletteIndex, id, {
      depth: options.depth,
      bevelSize: options.bevelSize,
      bevelThickness: options.bevelThickness,
      editableColor: options.editableColor,
      textureSize: options.textureSize,
      curveSegments: options.curveSegments,
      bevelSegments: options.bevelSegments,
      stitching: options.stitching,
    });
    glyph.glyph.position.x += width * 0.02;
    cursor += width + gap;
    glyphIndex += 1;
  });
  row.scale.x = options.scaleX ?? 1;
  row.position.x = options.x ?? 0;
  row.position.y = options.y;
  parent.add(row);
  return row;
}

export async function createPlushTypography({ phrase, layout = 'default' }) {
  const font = await fontPromise;
  const root = new THREE.Group();
  root.name = 'Plush Lesson Plan Typography';
  root.userData = {
    sourcePhrase: phrase,
    layout,
    actionReady: true,
    parts: layout === 'overlay'
      ? ['line-top', 'line-middle', 'line-middle-lower', 'line-bottom']
      : ['line-top', 'line-middle', 'line-bottom'],
    interactionPlan: ['row-reveal', 'glyph-bounce', 'magnetic-reassembly'],
  };
  const lines = layout === 'overlay'
    ? [
      { id: 'line-top', text: 'TEACHERS:', size: 0.70, scaleX: 0.94, x: 0.04, y: 3.55, gap: 0.018, wordGap: 0.14, paletteOffset: 0, paletteSequence: [0, 1, 2, 3, 4, 5, 6, 7, 2], bevelSize: 0.064, bevelThickness: 0.072, depth: 0.30 },
      { id: 'line-middle', text: 'HOW TO CREATE A', size: 0.46, scaleX: 0.86, y: 0.02, gap: 0.015, wordGap: 0.12, paletteOffset: 3, paletteSequence: [4, 6, 3, 1, 5, 2, 7, 3, 5, 2, 6, 3], bevelSize: 0.048, bevelThickness: 0.054, depth: 0.26 },
      { id: 'line-middle-lower', text: 'LESSON PLAN', size: 0.60, scaleX: 0.88, y: -0.72, gap: 0.016, wordGap: 0.13, paletteOffset: 5, paletteSequence: [6, 3, 2, 7, 1, 4, 5, 3, 6, 2], bevelSize: 0.054, bevelThickness: 0.060, depth: 0.28 },
      { id: 'line-bottom', text: 'IN 30 SECONDS', size: 0.53, scaleX: 0.88, y: -1.48, gap: 0.015, wordGap: 0.11, paletteOffset: 5, paletteSequence: [7, 6, 1, 4, 3, 5, 2, 6, 7, 1, 3], bevelSize: 0.052, bevelThickness: 0.058, depth: 0.28 },
    ]
    : [
      { id: 'line-top', text: 'TEACHERS:', size: 0.92, scaleX: 0.985, x: 0.20, y: 0.86, gap: 0.018, wordGap: 0.16, paletteOffset: 0, paletteSequence: [0, 1, 2, 3, 4, 5, 6, 7, 2], bevelSize: 0.075, bevelThickness: 0.084, depth: 0.22 },
      { id: 'line-middle', text: 'HOW TO CREATE A LESSON PLAN', size: 0.47, scaleX: 0.70, y: 0.09, gap: 0.014, wordGap: 0.15, paletteOffset: 3, paletteSequence: [4, 6, 3, 1, 5, 2, 7, 3, 5, 2, 6, 3, 2, 6, 3, 7, 1, 4, 5, 3, 6, 2], bevelSize: 0.046, bevelThickness: 0.052, depth: 0.16 },
      { id: 'line-bottom', text: 'IN 30 SECONDS', size: 0.63, scaleX: 0.9, y: -0.68, gap: 0.015, wordGap: 0.12, paletteOffset: 5, paletteSequence: [7, 6, 1, 4, 3, 5, 2, 6, 7, 1, 3], bevelSize: 0.05, bevelThickness: 0.058, depth: 0.18 },
    ];
  lines.forEach((line) => addTextRow(root, line.text, line, font));
  const glyphIds = [];
  root.traverse((node) => {
    if (node.userData?.physics && node.name.startsWith('glyph.')) glyphIds.push(node.name);
  });
  root.userData.glyphIds = glyphIds;
  root.userData.sculptRuntime = {
    hierarchy: 'root -> line -> glyph',
    colliderPolicy: 'one-cuboid-proxy-per-glyph',
    materialPolicy: 'one-seeded-plush-material-set-per-glyph',
    independentParts: glyphIds.length,
  };
  return root;
}

export async function createPlushAlphabet({
  letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?;:()[]{}+-=/%&@#*',
  characters,
  preserveDuplicates = false,
  size = 0.60,
  editableColor = true,
  textureSize = 512,
  curveSegments = 28,
  bevelSegments = 12,
  columns = 9,
  rowGap = 0.72,
} = {}) {
  const font = await fontPromise;
  const root = new THREE.Group();
  root.name = 'Plush Glyph Library';
  root.userData = {
    sourcePhrase: letters,
    layout: 'alphabet-grid',
    actionReady: true,
    detailLevel: 'hero',
    materialPolicy: 'neutral-detail-texture-plus-editable-tint',
    interactionPlan: ['letter-select', 'color-swap', 'scale-swap', 'physics-drop'],
  };

  const sourceCharacters = characters ?? letters;
  root.userData.sourcePhrase = sourceCharacters;
  const normalizedLetters = [...sourceCharacters].filter((character, index, list) => (
    character !== ' '
    && (preserveDuplicates || list.indexOf(character) === index)
    && font.charToGlyph(character)?.unicode
  )).join('');
  const rows = [];
  for (let index = 0; index < normalizedLetters.length; index += columns) {
    rows.push(normalizedLetters.slice(index, index + columns));
  }
  const firstRowY = ((rows.length - 1) * rowGap) / 2;
  rows.forEach((text, rowIndex) => addTextRow(root, text, {
    id: `alphabet-row-${rowIndex + 1}`,
    text,
    size,
    scaleX: 0.98,
    y: firstRowY - rowIndex * rowGap,
    gap: 0.055,
    wordGap: 0,
    paletteOffset: rowIndex * columns,
    editableColor,
    textureSize,
    curveSegments,
    bevelSegments,
    stitching: true,
    bevelSize: 0.064,
    bevelThickness: 0.074,
    depth: 0.30,
  }, font));

  const glyphs = [];
  root.traverse((node) => {
    if (node.userData?.physics && node.name.startsWith('glyph.')) glyphs.push(node);
  });
  const findLetter = (letter) => glyphs.find((glyph) => glyph.userData.character === String(letter).toUpperCase());
  root.userData.glyphIds = glyphs.map((glyph) => glyph.name);
  root.userData.letters = glyphs.map((glyph) => glyph.userData.character);
  root.userData.characters = root.userData.letters;
  root.userData.getLetter = (letter) => findLetter(letter) ?? null;
  root.userData.setColor = (letter, color) => findLetter(letter)?.userData.setColor?.(color);
  root.userData.setAllColor = (color) => glyphs.forEach((glyph) => glyph.userData.setColor?.(color));
  root.userData.setScale = (letter, value) => findLetter(letter)?.userData.setScale?.(value);
  root.userData.setDepth = (letter, value) => findLetter(letter)?.userData.setDepth?.(value);
  root.userData.sculptRuntime = {
    hierarchy: 'alphabet-root -> row -> glyph -> seam/body meshes',
    colliderPolicy: 'one-cuboid-proxy-per-letter',
    independentParts: glyphs.length,
    detail: { textureSize, curveSegments, bevelSegments },
  };
  return root;
}
