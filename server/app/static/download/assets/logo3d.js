// Logo do Resenha em 3D: o path do SVG extrudado como um brinquedo de vinil.
// Sem WebGL (ou se algo falhar), fica a imagem 2D que já está na página.
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const stage = document.querySelector('[data-logo-stage]');
const canvas = stage.querySelector('canvas');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const DEG = Math.PI / 180;
const SWING = 25 * DEG; // balanço automático em Y
const THREE_QUARTER = -32 * DEG; // pose parada com movimento reduzido
const FILL = 0.82; // quanto da largura do palco o logo ocupa

function hasWebGL() {
  try {
    const test = document.createElement('canvas');
    return !!(test.getContext('webgl2') || test.getContext('webgl'));
  } catch {
    return false;
  }
}

function buildLogo(svgText) {
  const data = new SVGLoader().parse(svgText);
  const shapes = data.paths.flatMap((path) => SVGLoader.createShapes(path));
  const box = new THREE.Box2();
  shapes.forEach((shape) => shape.getPoints().forEach((p) => box.expandByPoint(p)));
  const width = box.max.x - box.min.x;
  const height = box.max.y - box.min.y;

  const depth = width * 0.09;
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth,
    curveSegments: 24,
    bevelEnabled: true,
    bevelThickness: width * 0.016,
    bevelSize: width * 0.009,
    bevelSegments: 6,
  });
  geometry.center();

  // Grupo 0: frente e verso (laranja). Grupo 1: laterais, bevel e paredes dos furos (quase pretos).
  const vinyl = new THREE.MeshPhysicalMaterial({
    color: '#FFB547',
    roughness: 0.35,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.55,
  });
  const rim = new THREE.MeshPhysicalMaterial({
    color: '#08080A',
    roughness: 0.55,
    metalness: 0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.22,
  });
  const mesh = new THREE.Mesh(geometry, [vinyl, rim]);
  mesh.scale.y = -1; // o SVG cresce para baixo
  return { mesh, width, height, depth };
}

function contactShadow(width) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(8, 11, 48, 0.75)');
  grad.addColorStop(0.45, 'rgba(10, 14, 56, 0.4)');
  grad.addColorStop(1, 'rgba(18, 26, 92, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.15, width * 0.42),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  plane.rotation.x = -Math.PI / 2;
  return plane;
}

async function start() {
  if (!hasWebGL()) return;
  const svgText = await (await fetch(stage.dataset.svg)).text();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  pmrem.dispose();

  const { mesh, width, height } = buildLogo(svgText);
  const pivot = new THREE.Group(); // gira e flutua
  pivot.add(mesh);
  scene.add(pivot);

  const floorY = -height / 2 - width * 0.12;
  const shadow = contactShadow(width);
  shadow.position.y = floorY;
  scene.add(shadow);

  // Luz principal quente pela frente/esquerda, contraluz frio por trás/direita
  const key = new THREE.DirectionalLight('#FFE0BC', 2.4);
  key.position.set(-1.1, 1.4, 2.2);
  const back = new THREE.DirectionalLight('#8EAEFF', 3.2);
  back.position.set(1.8, 0.8, -1.6);
  const fill = new THREE.HemisphereLight('#FFF4E6', '#121A5C', 0.5);
  scene.add(key, back, fill);

  const camera = new THREE.PerspectiveCamera(28, 1, width * 0.05, width * 20);
  const target = new THREE.Vector3(0, -width * 0.035, 0);

  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tan = Math.tan((camera.fov * DEG) / 2);
    // Distância para o logo ocupar FILL da largura (ou caber na altura, com espaço para a sombra)
    const byWidth = width / 2 / (tan * camera.aspect * FILL);
    const byHeight = (height * 0.5 + width * 0.16) / (tan * 0.98);
    const dist = Math.max(byWidth, byHeight);
    camera.position.set(0, dist * 0.16, dist);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    wake();
  }

  // ---------- Movimento ----------
  let reduced = reducedMotion.matches;
  let userYaw = 0;
  let yawVel = 0; // rad/s
  let pitch = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastMove = 0;
  let clock = 0; // tempo de animação (para quando a aba some)
  let lastFrame = 0;
  let frameId = 0;
  let onScreen = true;
  let shown = false;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    yawVel = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    lastMove = performance.now();
    canvas.setPointerCapture(e.pointerId);
    wake();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const now = performance.now();
    const dt = Math.max((now - lastMove) / 1000, 1 / 240);
    const dYaw = (e.clientX - lastX) * 0.009;
    userYaw += dYaw;
    yawVel = yawVel * 0.4 + (dYaw / dt) * 0.6;
    if (e.pointerType === 'mouse') pitch = THREE.MathUtils.clamp(pitch + (e.clientY - lastY) * 0.005, -0.35, 0.35);
    lastX = e.clientX;
    lastY = e.clientY;
    lastMove = now;
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    if (performance.now() - lastMove > 80) yawVel = 0; // soltou parado
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  function settled() {
    return !dragging && Math.abs(yawVel) < 0.002;
  }

  function step(dt) {
    if (!dragging) {
      userYaw += yawVel * dt;
      yawVel *= Math.exp(-dt * 2.4); // inércia
      if (Math.abs(yawVel) < 0.002) yawVel = 0;
      if (!reduced && Math.abs(yawVel) < 0.6) {
        // volta devagar para o balanço automático (na volta inteira mais próxima)
        const home = Math.round(userYaw / (Math.PI * 2)) * Math.PI * 2;
        userYaw += (home - userYaw) * (1 - Math.exp(-dt * 0.9));
        pitch += (0 - pitch) * (1 - Math.exp(-dt * 1.5));
      }
    }
    const auto = reduced ? THREE_QUARTER : Math.sin(clock * 0.42) * SWING;
    const bob = reduced ? 0 : Math.sin(clock * 1.05) * width * 0.018;
    pivot.rotation.set(pitch + (reduced ? 6 * DEG : Math.sin(clock * 0.8) * 2.5 * DEG), auto + userYaw, 0);
    pivot.position.y = bob;
    // A sombra encolhe e clareia quando o logo sobe
    const lift = bob / (width * 0.018 || 1);
    shadow.scale.setScalar(1 - lift * 0.05);
    shadow.material.opacity = 0.9 - lift * 0.12;
  }

  function frame(now) {
    frameId = 0;
    const dt = Math.min((now - (lastFrame || now)) / 1000, 1 / 20);
    lastFrame = now;
    if (!reduced) clock += dt;
    step(dt);
    renderer.render(scene, camera);
    if (!shown) {
      shown = true;
      stage.classList.add('is-3d');
    }
    if (!document.hidden && onScreen && (!reduced || !settled())) frameId = requestAnimationFrame(frame);
  }

  function wake() {
    if (frameId || document.hidden) return;
    lastFrame = 0;
    frameId = requestAnimationFrame(frame);
  }

  function sleep() {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
  }

  document.addEventListener('visibilitychange', () => (document.hidden ? sleep() : wake()));
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen) wake();
    else sleep();
  }).observe(stage);
  reducedMotion.addEventListener('change', (e) => {
    reduced = e.matches;
    userYaw = 0;
    yawVel = 0;
    pitch = 0;
    wake();
  });
  new ResizeObserver(resize).observe(stage);
  resize();
}

start().catch((err) => console.warn('Logo 3D indisponível; usando a imagem 2D.', err));
