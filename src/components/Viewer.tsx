import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { geometry } from '../worker/client';
import type { MeshData } from '../lib/geometry/kernel';

export interface SceneItem {
  id: string;
  meshKey: string;
  /** Min corner of the footprint in world space (after rotation). */
  x: number;
  y: number;
  z: number;
  /** Unrotated footprint and height, used for placeholders and rotation. */
  w: number;
  d: number;
  h: number;
  rotated?: boolean;
  color: string;
  selected?: boolean;
  pickable?: boolean;
}

export interface SceneBed {
  x: number;
  y: number;
  w: number;
  d: number;
  label: string;
}

export interface ViewerProps {
  items: SceneItem[];
  beds?: SceneBed[];
  /** Drawer outline drawn on the ground. */
  outline?: { w: number; d: number };
  /** Camera re-frames whenever this changes. */
  fitKey: string;
  /** Frame only these item ids (default: everything). */
  fitIds?: string[];
  /** Overlay controls (rendered over the canvas). */
  children?: ReactNode;
  onPick?: (id: string | null) => void;
}

const SELECT_COLOR = '#f5a524';

function useGeometryVersion() {
  return useSyncExternalStore(
    (cb) => geometry.subscribe(cb),
    () => geometry.getVersion(),
  );
}

export function Viewer({ items, beds, outline, fitKey, fitIds, onPick, children }: ViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<ReturnType<typeof createContext> | null>(null);
  const version = useGeometryVersion();
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    const c = createContext(host.current!, (id) => pickRef.current?.(id));
    ctx.current = c;
    return () => c.dispose();
  }, []);

  useEffect(() => {
    ctx.current?.setScene(items, beds ?? [], outline);
  }, [items, beds, outline, version]);

  useEffect(() => {
    const only = fitIds?.length ? items.filter((it) => fitIds.includes(it.id)) : null;
    if (only?.length) ctx.current?.fit(only, []);
    else ctx.current?.fit(items, beds ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return (
    <div className="viewer">
      <div ref={host} className="viewer-canvas" />
      {children}
    </div>
  );
}

function createContext(el: HTMLDivElement, pick: (id: string | null) => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
  camera.up.set(0, 0, 1);
  camera.position.set(300, -500, 400);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.zoomToCursor = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-0.6, -1, 1.6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5);
  rim.position.set(1, 0.8, 0.6);
  scene.add(rim);

  const world = new THREE.Group();
  const bedGroup = new THREE.Group();
  const helpers = new THREE.Group();
  scene.add(world, bedGroup, helpers);

  const geoms = new Map<string, { mesh: THREE.BufferGeometry; edges: THREE.BufferGeometry }>();
  const mats = new Map<string, THREE.Material>();
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 });
  const placeholderMat = new THREE.MeshBasicMaterial({ color: 0x8a93a3, transparent: true, opacity: 0.12 });
  const placeholderEdge = new THREE.LineBasicMaterial({ color: 0x8a93a3, transparent: true, opacity: 0.5 });
  const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
  const unitBoxEdges = new THREE.EdgesGeometry(unitBox);

  function material(color: string) {
    let m = mats.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.04 });
      mats.set(color, m);
    }
    return m;
  }

  function geometryFor(key: string, data: MeshData) {
    let g = geoms.get(key);
    if (!g) {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      bg.setIndex(new THREE.BufferAttribute(data.indices, 1));
      const mesh = toCreasedNormals(bg, Math.PI / 7);
      const edges = new THREE.EdgesGeometry(bg, 28);
      bg.dispose();
      mesh.computeBoundingSphere();
      g = { mesh, edges };
      geoms.set(key, g);
    }
    return g;
  }

  let lastBedKey = '';
  let needsRender = true;
  const requestRender = () => (needsRender = true);
  controls.addEventListener('change', requestRender);

  function setScene(items: SceneItem[], beds: SceneBed[], outline?: { w: number; d: number }) {
    world.clear();
    const used = new Set<string>();
    for (const it of items) {
      const data = geometry.mesh(it.meshKey);
      const obj = new THREE.Group();
      if (it.rotated) {
        obj.rotation.z = Math.PI / 2;
        obj.position.set(it.x + it.d, it.y, it.z);
      } else {
        obj.position.set(it.x, it.y, it.z);
      }
      if (data) {
        used.add(it.meshKey);
        const g = geometryFor(it.meshKey, data);
        const mesh = new THREE.Mesh(g.mesh, material(it.selected ? SELECT_COLOR : it.color));
        mesh.userData.id = it.pickable ? it.id : null;
        obj.add(mesh, new THREE.LineSegments(g.edges, edgeMat));
      } else {
        const ph = new THREE.Mesh(unitBox, placeholderMat);
        ph.scale.set(it.w, it.d, Math.max(it.h, 1));
        const phe = new THREE.LineSegments(unitBoxEdges, placeholderEdge);
        phe.scale.copy(ph.scale);
        ph.userData.id = it.pickable ? it.id : null;
        obj.add(ph, phe);
      }
      world.add(obj);
    }
    // Drop GPU buffers nobody shows anymore.
    for (const [k, g] of geoms) {
      if (!used.has(k)) {
        g.mesh.dispose();
        g.edges.dispose();
        geoms.delete(k);
      }
    }

    const bedKey = beds.map((b) => `${b.x},${b.y},${b.w},${b.d},${b.label}`).join('|');
    if (bedKey !== lastBedKey) {
      lastBedKey = bedKey;
      disposeTree(bedGroup);
      bedGroup.clear();
      for (const b of beds) bedGroup.add(makeBed(b));
    }

    disposeTree(helpers);
    helpers.clear();
    if (outline) {
      const pts = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(outline.w, 0, 0),
        new THREE.Vector3(outline.w, outline.d, 0),
        new THREE.Vector3(0, outline.d, 0),
        new THREE.Vector3(0, 0, 0),
      ];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineDashedMaterial({ color: 0x9aa4b5, dashSize: 6, gapSize: 4 }),
      );
      line.computeLineDistances();
      helpers.add(line);
    }
    requestRender();
  }

  // Re-frame on resize until the user moves the camera themselves.
  let lastFit: { items: SceneItem[]; beds: SceneBed[] } | null = null;
  let userMoved = false;
  controls.addEventListener('start', () => (userMoved = true));

  function fit(items: SceneItem[], beds: SceneBed[]) {
    lastFit = { items, beds };
    userMoved = false;
    const box = new THREE.Box3();
    for (const it of items) {
      const w = it.rotated ? it.d : it.w;
      const d = it.rotated ? it.w : it.d;
      box.expandByPoint(new THREE.Vector3(it.x, it.y, it.z));
      box.expandByPoint(new THREE.Vector3(it.x + w, it.y + d, it.z + it.h));
    }
    for (const b of beds) {
      box.expandByPoint(new THREE.Vector3(b.x, b.y, 0));
      box.expandByPoint(new THREE.Vector3(b.x + b.w, b.y + b.d, 0));
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const dir = new THREE.Vector3(0.18, -0.78, 0.82).normalize();
    const corners: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    // Binary-search the camera distance so every corner projects inside the frame.
    const v = new THREE.Vector3();
    const fits = (d: number) => {
      camera.position.copy(center).addScaledVector(dir, d);
      camera.lookAt(center);
      camera.updateMatrixWorld();
      return corners.every((c) => {
        v.copy(c).project(camera);
        return Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.86 && v.z < 1;
      });
    };
    const span = Math.max(size.x, size.y, size.z, 10);
    let lo = span * 0.2;
    let hi = span * 20;
    camera.near = 0.5;
    camera.far = hi * 4;
    camera.updateProjectionMatrix();
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    fits(hi);
    camera.near = Math.max(0.5, hi / 300);
    camera.far = hi * 20;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
    requestRender();
  }

  // picking
  const ray = new THREE.Raycaster();
  let down: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
  const onUp = (e: PointerEvent) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(
      new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1),
      camera,
    );
    const hit = ray.intersectObjects(world.children, true).find((h) => h.object.userData.id !== undefined);
    pick((hit?.object.userData.id as string | null) ?? null);
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);

  const resize = () => {
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (lastFit && !userMoved) fit(lastFit.items, lastFit.beds);
    requestRender();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    controls.update();
    if (needsRender) {
      needsRender = false;
      renderer.render(scene, camera);
    }
  };
  loop();

  return {
    setScene,
    fit,
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      for (const g of geoms.values()) {
        g.mesh.dispose();
        g.edges.dispose();
      }
      disposeTree(bedGroup);
      disposeTree(helpers);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      (x as THREE.MeshStandardMaterial).map?.dispose();
      x.dispose();
    }
  });
}

function makeBed(b: SceneBed) {
  const g = new THREE.Group();
  const canvas = document.createElement('canvas');
  const px = 512;
  canvas.width = px;
  canvas.height = Math.round((px * b.d) / b.w);
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#2a2f38';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.strokeStyle = 'rgba(255,255,255,0.07)';
  c.lineWidth = 1;
  const step = (canvas.width / b.w) * 10;
  for (let x = 0; x < canvas.width; x += step) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, canvas.height);
    c.stroke();
  }
  for (let y = 0; y < canvas.height; y += step) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(canvas.width, y);
    c.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const plane = new THREE.Mesh(
    new THREE.BoxGeometry(b.w, b.d, 1.2).translate(b.w / 2, b.d / 2, -0.61),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }),
  );
  plane.position.set(b.x, b.y, 0);
  g.add(plane);

  // Label in front of the bed so parts never cover it.
  const lc = document.createElement('canvas');
  lc.width = 1024;
  lc.height = 96;
  const l = lc.getContext('2d')!;
  l.fillStyle = 'rgba(231,233,236,0.75)';
  l.font = '600 64px system-ui, sans-serif';
  l.textBaseline = 'middle';
  l.fillText(b.label, 8, 50);
  const ltex = new THREE.CanvasTexture(lc);
  ltex.colorSpace = THREE.SRGBColorSpace;
  const lh = (b.w * lc.height) / lc.width;
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(b.w, lh).translate(b.w / 2, -lh / 2 - 4, 0),
    new THREE.MeshBasicMaterial({ map: ltex, transparent: true, depthWrite: false }),
  );
  label.position.set(b.x, b.y, 0.05);
  g.add(label);
  return g;
}
