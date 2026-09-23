import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { KnowledgeItem, KnowledgeLink } from '$lib/modules/agent-room/domain/knowledge.js';
import type { GraphPosition } from './knowledge-graph-layout.js';
import { graphLinks, graphPointer, graphColors } from './knowledge-graph-view.js';
export type GraphLabel = { id: string; x: number; y: number; title: string; color: string; active: boolean };
type Callbacks = { labels: (labels: GraphLabel[]) => void; select: (id: string) => void; hover: (id: string | null) => void; moved: (id: string, point: GraphPosition) => void; failed: () => void };

/** One WebGL surface, no nested flow canvas, no perpetual animation loop. */
export class KnowledgeGraphRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-400, 400, 300, -300, 0.1, 10000);
  private controls: OrbitControls;
  private points: THREE.InstancedMesh | null = null;
  private lines: THREE.LineSegments | null = null;
  private geometry = new THREE.SphereGeometry(1, 16, 12);
  private pointMaterial = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05 });
  private lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.42 });
  private ray = new THREE.Raycaster();
  private items: KnowledgeItem[] = [];
  private links: KnowledgeLink[] = [];
  private positions: Record<string, GraphPosition> = {};
  private degrees = new Map<string, number>();
  private selected: string | null = null;
  private hovered: string | null = null;
  private highlighted = new Set<string>();
  private mode: '2d' | '3d' = '3d';
  private width = 1; private height = 1;
  private frame = 0; private disposed = false; private visible = true;
  private down: { id: string | null; x: number; y: number; moved: boolean; touch: boolean; plane: THREE.Plane; offset: THREE.Vector3 } | null = null;
  private resize: ResizeObserver;
  private intersection: IntersectionObserver;
  private theme: MutationObserver;
  private dark = true;
  private colors: Record<string, string> = {};
  private cleanups: Array<() => void> = [];

  constructor(private host: HTMLElement, private callbacks: Callbacks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const canvas = this.renderer.domElement;
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;outline:none';
    canvas.dataset.testid = 'knowledge-network';
    canvas.setAttribute('aria-hidden', 'true');
    host.prepend(canvas);
    this.camera.position.set(0, -260, 800);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false;
    this.controls.minZoom = 0.08; this.controls.maxZoom = 12;
    this.controls.addEventListener('change', this.invalidate);
    this.scene.add(new THREE.AmbientLight(0xffffff, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(-100, 250, 400); this.scene.add(light);
    this.controls.update();
    this.resize = new ResizeObserver(() => this.measure()); this.resize.observe(host);
    this.intersection = new IntersectionObserver(([entry]) => { this.visible = entry.isIntersecting; if (this.visible) this.invalidate(); }); this.intersection.observe(host);
    this.theme = new MutationObserver(() => { this.readTheme(); this.paint(); });
    this.theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    this.readTheme();
    this.listen(canvas, 'pointerdown', this.pointerDown, true);
    this.listen(canvas, 'pointermove', this.pointerMove, true);
    this.listen(canvas, 'pointerup', this.pointerUp, true);
    this.listen(canvas, 'pointercancel', this.pointerCancel, true);
    this.listen(canvas, 'lostpointercapture', this.pointerCancel, true);
    this.listen(canvas, 'pointerleave', () => { if (!this.down) this.hover(null); });
    this.listen(canvas, 'dblclick', (event: MouseEvent) => { event.stopPropagation(); const id = this.pick(event.clientX, event.clientY); if (id) this.focus(id); });
    this.listen(canvas, 'contextmenu', (event: Event) => { event.preventDefault(); event.stopPropagation(); });
    this.listen(canvas, 'webglcontextlost', (event: Event) => { event.preventDefault(); callbacks.failed(); });
    this.listen(document, 'visibilitychange', () => { if (!document.hidden) this.invalidate(); });
    // Block outer gesture starts, not move/up: OrbitControls tracks those on
    // ownerDocument. Blocking their bubbling would silently freeze rotation.
    for (const event of ['pointerdown', 'wheel', 'dblclick']) this.listen(host, event, (e: Event) => e.stopPropagation());
    this.measure();
  }

  private listen(target: EventTarget, name: string, fn: (event: any) => void, capture = false) {
    target.addEventListener(name, fn, capture); this.cleanups.push(() => target.removeEventListener(name, fn, capture));
  }
  private readTheme() {
    const color = getComputedStyle(this.host).getPropertyValue('--app-bg').trim();
    try { const c = new THREE.Color(color); this.dark = c.r + c.g + c.b < 1.5; } catch { this.dark = true; }
    this.lineMaterial.opacity = this.dark ? 0.42 : 0.5;
  }
  private measure() {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height) return;
    const extent = (this.camera.top - this.camera.bottom) / 2 || 300;
    this.width = width; this.height = height;
    this.camera.left = -extent * width / height; this.camera.right = extent * width / height;
    this.camera.top = extent; this.camera.bottom = -extent;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false); this.invalidate();
  }
  private point(id: string) {
    const p = this.positions[id] ?? { x: 0, y: 0, z: 0 };
    return new THREE.Vector3(p.x, p.y, this.mode === '3d' ? p.z : 0);
  }
  private radius(id: string) { return 3 + Math.min(6, Math.sqrt(this.degrees.get(id) ?? 0) * 1.2); }
  setColors(colors: Record<string, string>) { this.colors = colors; this.paint(); }

  update(items: KnowledgeItem[], links: KnowledgeLink[], positions: Record<string, GraphPosition>, fit = false) {
    this.items = items; this.links = graphLinks(items.map(item => item.id), links); this.positions = positions;
    this.degrees.clear();
    for (const link of this.links) for (const id of [link.source, link.target]) this.degrees.set(id, (this.degrees.get(id) ?? 0) + 1);
    if (this.points) { this.scene.remove(this.points); this.points.dispose(); }
    this.points = new THREE.InstancedMesh(this.geometry, this.pointMaterial, items.length);
    this.points.frustumCulled = false; this.scene.add(this.points);
    if (this.lines) { this.scene.remove(this.lines); this.lines.geometry.dispose(); }
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.lineMaterial); this.lines.frustumCulled = false; this.scene.add(this.lines);
    this.paint(); if (fit) this.fit();
  }
  select(id: string | null) { this.selected = id; this.paint(); }
  private hover(id: string | null) {
    if (id === this.hovered) return;
    this.hovered = id; this.host.style.cursor = id ? 'pointer' : 'grab'; this.callbacks.hover(id); this.paint();
  }
  private paint() {
    if (!this.points || !this.lines) return;
    const candidate = this.hovered ?? this.selected;
    const active = this.items.some(item => item.id === candidate) ? candidate : null;
    this.highlighted = new Set(active ? [active] : []);
    for (const link of this.links) if (link.source === active || link.target === active) { this.highlighted.add(link.source); this.highlighted.add(link.target); }
    const transform = new THREE.Object3D();
    for (const [index, item] of this.items.entries()) {
      transform.position.copy(this.point(item.id));
      transform.scale.setScalar(this.radius(item.id) * (item.id === active ? 1.3 : 1)); transform.updateMatrix();
      this.points.setMatrixAt(index, transform.matrix);
      const color = new THREE.Color(this.colors[item.id] ?? graphColors[item.kind]);
      if (!this.dark) color.multiplyScalar(0.63);
      if (active && !this.highlighted.has(item.id)) color.lerp(new THREE.Color(this.dark ? '#202934' : '#c6cbd1'), 0.8);
      this.points.setColorAt(index, color);
    }
    this.points.instanceMatrix.needsUpdate = true;
    if (this.points.instanceColor) this.points.instanceColor.needsUpdate = true;
    this.points.computeBoundingSphere();
    const vertices: number[] = [], colors: number[] = [];
    const byId = new Map(this.items.map(item => [item.id, item]));
    for (const link of this.links) {
      const dim = active && link.source !== active && link.target !== active;
      for (const id of [link.source, link.target]) {
        vertices.push(...this.point(id).toArray());
        const color = new THREE.Color(dim ? (this.dark ? '#242a32' : '#cbd0d5') : this.colors[id] ?? graphColors[byId.get(id)!.kind]);
        if (!this.dark) color.multiplyScalar(0.7);
        colors.push(...color.toArray());
      }
    }
    this.lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.lines.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.invalidate();
  }
  setMode(mode: '2d' | '3d') {
    if (this.mode === mode) return;
    this.mode = mode; this.controls.enableRotate = mode === '3d';
    this.controls.mouseButtons.LEFT = mode === '3d' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    this.controls.touches.ONE = mode === '3d' ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN;
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(0, mode === '3d' ? -distance * 0.3 : 0, distance));
    this.camera.up.set(0, 1, 0); this.controls.update(); this.paint();
  }
  fit() {
    if (!this.items.length) return;
    const box = new THREE.Box3().setFromPoints(this.items.map(item => this.point(item.id)));
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const radius = Math.max(70, Math.max(size.x, size.y, size.z) / 2 + 25);
    const extent = radius * 1.2 / Math.min(1, this.width / this.height);
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(0, this.mode === '3d' ? -radius * 0.8 : 0, radius * 3 + 300));
    this.camera.up.set(0, 1, 0); this.camera.zoom = 1;
    this.camera.top = extent; this.camera.bottom = -extent;
    this.measure(); this.controls.update(); this.invalidate();
  }
  focus(id: string) {
    if (!this.positions[id]) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.copy(this.point(id)); this.camera.position.copy(this.controls.target).add(offset);
    this.camera.zoom = Math.max(this.camera.zoom, 1.8); this.camera.updateProjectionMatrix(); this.controls.update(); this.invalidate();
  }
  zoom(factor: number) { this.camera.zoom = Math.min(12, Math.max(0.08, this.camera.zoom * factor)); this.camera.updateProjectionMatrix(); this.invalidate(); }
  pan(x: number, y: number) {
    const distance = (this.camera.top - this.camera.bottom) / this.camera.zoom / this.height;
    const offset = new THREE.Vector3(x * distance, y * distance, 0).applyQuaternion(this.camera.quaternion);
    this.camera.position.add(offset); this.controls.target.add(offset); this.controls.update(); this.invalidate();
  }
  private pick(x: number, y: number): string | null {
    if (!this.points) return null;
    this.camera.updateMatrixWorld(); this.points.updateMatrixWorld();
    this.ray.setFromCamera(new THREE.Vector2().copy(graphPointer(x, y, this.renderer.domElement.getBoundingClientRect())), this.camera);
    const hit = this.ray.intersectObject(this.points)[0];
    if (hit?.instanceId !== undefined) return this.items[hit.instanceId]?.id ?? null;
    // Small points retain a usable screen-space hit area, including outer zoom.
    const rect = this.renderer.domElement.getBoundingClientRect();
    let closest: string | null = null, distance = 10;
    for (const item of this.items) {
      const p = this.point(item.id).project(this.camera);
      if (p.z < -1 || p.z > 1) continue;
      const d = Math.hypot(rect.left + (p.x + 1) / 2 * rect.width - x, rect.top + (1 - p.y) / 2 * rect.height - y);
      if (d < distance) { closest = item.id; distance = d; }
    }
    return closest;
  }
  private pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const id = this.pick(event.clientX, event.clientY);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()), id ? this.point(id) : this.controls.target);
    const intersection = this.ray.ray.intersectPlane(plane, new THREE.Vector3());
    const touch = event.pointerType === 'touch';
    this.down = { id, x: event.clientX, y: event.clientY, moved: Boolean(touch && this.down), touch, plane, offset: id && intersection ? this.point(id).sub(intersection) : new THREE.Vector3() };
    if (id && !touch) { this.controls.enabled = false; this.renderer.domElement.setPointerCapture(event.pointerId); event.stopImmediatePropagation(); }
  };
  private pointerMove = (event: PointerEvent) => {
    if (!this.down) { this.hover(this.pick(event.clientX, event.clientY)); return; }
    if (Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 4) this.down.moved = true;
    if (!this.down.id || !this.down.moved || this.down.touch) return;
    this.ray.setFromCamera(new THREE.Vector2().copy(graphPointer(event.clientX, event.clientY, this.renderer.domElement.getBoundingClientRect())), this.camera);
    const p = this.ray.ray.intersectPlane(this.down.plane, new THREE.Vector3());
    if (p) {
      p.add(this.down.offset);
      const id = this.down.id;
      const point = { x: p.x, y: p.y, z: this.mode === '3d' ? p.z : this.positions[id].z };
      this.positions[id] = point; this.callbacks.moved(id, point); this.paint();
    }
    event.stopImmediatePropagation();
  };
  private pointerUp = (event: PointerEvent) => {
    const down = this.down;
    this.down = null; this.controls.enabled = true;
    if (down?.id) {
      if (!down.touch) {
        event.stopImmediatePropagation();
        if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
      }
      if (!down.moved) this.callbacks.select(down.id);
    }
  };
  private pointerCancel = () => { this.down = null; this.controls.enabled = true; };

  private invalidate = () => {
    if (this.disposed || this.frame || !this.visible || document.hidden) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  };
  private draw() {
    this.renderer.render(this.scene, this.camera);
    const active = this.hovered ?? this.selected;
    const ranked = [...this.items].sort((a, b) => Number(b.id === active) - Number(a.id === active) || Number(this.highlighted.has(b.id)) - Number(this.highlighted.has(a.id)) || (this.degrees.get(b.id) ?? 0) - (this.degrees.get(a.id) ?? 0));
    const labels: GraphLabel[] = [], occupied: Array<{ x: number; y: number; w: number }> = [];
    for (const item of ranked) {
      if (labels.length >= 24 && item.id !== active) break;
      const point = this.point(item.id).project(this.camera);
      const x = (point.x + 1) / 2 * this.width, y = (1 - point.y) / 2 * this.height;
      if (point.z < -1 || point.z > 1 || x < 12 || x > this.width - 12 || y < 12 || y > this.height - 34) continue;
      const w = Math.min(165, 20 + item.title.length * 6.5);
      if (item.id !== active && occupied.some(p => Math.abs(p.x - x) < (p.w + w) / 2 && Math.abs(p.y - y) < 28)) continue;
      occupied.push({ x, y, w }); labels.push({ id: item.id, x, y: y + 10, title: item.title, color: graphColors[item.kind], active: this.highlighted.has(item.id) });
    }
    this.callbacks.labels(labels);
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frame);
    this.resize.disconnect(); this.intersection.disconnect(); this.theme.disconnect();
    this.cleanups.forEach(cleanup => cleanup()); this.controls.dispose();
    this.points?.dispose(); this.lines?.geometry.dispose(); this.geometry.dispose(); this.pointMaterial.dispose(); this.lineMaterial.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
