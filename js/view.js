// 渲染：根据客户端世界（World）绘制 3D 场景、特效、镜头和界面
// 红方玩家的镜头旋转 180°，让双方都是“自己的基地在左下角”
import * as THREE from 'three';
import { buildMap } from './map.js';
import { buildHero, buildMinion, buildTower, buildCrystal, buildTyrant, buildGolem } from './models.js';
import { FX, Indicator } from './fx.js';
import { UI } from './ui.js';

const AURAS = { redbuff: [0xff5a1a, 1.3], bluebuff: [0x3aa8ff, 1.55], tyrant: [0xc07bff, 1.8] };

export class View {
  constructor(client) {
    this.c = client;
    this.world = client.world;
    this.flip = client.team === 1;
    this.mobile = matchMedia('(pointer: coarse)').matches;
    this.quality = client.opts.quality || (this.mobile ? 'low' : 'high');
    this.shakeAmp = 0;
    this.corpses = [];
    this.projMeshes = new Map();
    this.towerRings = [];
    this.recallFx = new Map();
    this.beams = new Map();
    this.endFocus = null;
    this.clock = 0;
    this.initRenderer();
    this.fx = new FX(this.scene);
    this.indicator = new Indicator(this.scene);
    this.ui = new UI(client, this);
    this.camTarget = new THREE.Vector3();
    this.world.onAdd = (r) => this.addRep(r);
    this.world.onRemove = (r) => this.removeRep(r);
    this.world.onHeroDeath = (r) => this.corpses.push({ r, t: 0, dur: 1.4, hero: true });
    this.world.onTowerDeath = (r) => {
      this.corpses.push({ r, t: 0, dur: r.kind === 'crystal' ? 1.5 : 1.2, keep: true });
      this.ui.removeBar(r);
    };
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  initRenderer() {
    const host = document.getElementById('game');
    const renderer = new THREE.WebGLRenderer({ antialias: !this.mobile, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.mobile ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8fc4e8);
    scene.fog = new THREE.Fog(0x8fc4e8, 45, 95);
    this.scene = scene;
    scene.add(new THREE.HemisphereLight(0xdff1ff, 0x4a6b35, 1.1));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    sun.castShadow = true;
    const sm = this.quality === 'low' ? 1024 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    const sc = sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 90;
    sun.shadow.bias = -0.0008;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 200);
    this.map = buildMap(scene, this.quality);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const portrait = h > w;
    this.camOffset = portrait ? new THREE.Vector3(0, 42, 24) : new THREE.Vector3(0, 27, 17);
    const mmSize = portrait || h < 500 ? 110 : 140;
    if (this.mm !== mmSize) {
      this.mm = mmSize;
      const mmEl = document.getElementById('minimap');
      mmEl.width = mmEl.height = mmSize;
    }
  }

  // 镜头偏移（红方旋转 180°）
  camOffsetWorld() {
    const o = this.camOffset;
    return this.flip ? new THREE.Vector3(-o.x, o.y, -o.z) : o;
  }

  snapCamera() {
    const p = this.world.me;
    if (!p) return;
    this.camTarget.set(p.x, 0, p.z);
    this.camera.position.copy(this.camTarget).add(this.camOffsetWorld());
    this.camera.lookAt(this.camTarget);
  }

  shake(a) { this.shakeAmp = Math.max(this.shakeAmp, a); }

  // ---------- 单位模型 ----------
  addRep(r) {
    let m;
    if (r.kind === 'hero') { m = buildHero(r.def, r.team); m.userData.body.scale.setScalar(1.15); }
    else if (r.kind === 'minion') m = buildMinion(r.type, r.team);
    else if (r.kind === 'tower') m = buildTower(r.team);
    else if (r.kind === 'crystal') m = buildCrystal(r.team);
    else m = r.def.id === 'tyrant' ? buildTyrant() : buildGolem(r.def.id);
    m.position.set(r.x, r.y, r.z);
    if (r.kind === 'tower' || r.kind === 'crystal') {
      m.traverse((o) => { o.receiveShadow = true; });
      if (!r.alive) { m.scale.y = 0.3; m.position.y = -0.5; }
      if (r.team !== this.world.team) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(r.stats.range + r.radius - 0.15, r.stats.range + r.radius, 64),
          new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.5, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(r.x, 0.11, r.z);
        ring.visible = false;
        this.scene.add(ring);
        this.towerRings.push({ r, ring });
      }
    }
    if (r.kind === 'hero' && !r.alive) m.visible = false;
    r.mesh = m;
    this.scene.add(m);
    if (r.alive) this.ui.createBar(r);
  }

  removeRep(r) {
    this.ui.removeBar(r);
    if (r.kind === 'minion' || r.kind === 'monster') this.corpses.push({ r, t: 0, dur: r.kind === 'monster' ? 1.2 : 0.7 });
    else { this.scene.remove(r.mesh); }
  }

  syncMesh(r, dt) {
    const m = r.mesh;
    m.position.set(r.x, r.y, r.z);
    const body = m.userData.body;
    if (body) {
      let d = r.facing - body.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      body.rotation.y += d * Math.min(1, dt * 14);
      if (r.anim.spin > 0) {
        r.anim.spin -= dt;
        body.rotation.y += dt * 22;
      }
      if (r.anim.moving) r.anim.walk += dt * (r.stats.speed || 4.4) * 1.6;
      const sw = r.anim.moving ? Math.sin(r.anim.walk) : 0;
      const legL = body.getObjectByName('legL'), legR = body.getObjectByName('legR');
      if (legL) legL.rotation.x = sw * 0.6;
      if (legR) legR.rotation.x = -sw * 0.6;
      body.position.y = r.anim.moving ? Math.abs(Math.cos(r.anim.walk)) * 0.08 : 0;
      const arm = body.getObjectByName('arm');
      if (arm) {
        if (r.anim.atk > 0) {
          r.anim.atk -= dt;
          const k = r.anim.atk / 0.25;
          arm.rotation.x = -Math.sin(k * Math.PI) * 1.4;
          arm.rotation.y = Math.sin(k * Math.PI) * 0.6;
        } else {
          arm.rotation.x = sw * 0.3;
          arm.rotation.y *= 0.8;
        }
      }
      const cape = body.getObjectByName('cape');
      if (cape) cape.rotation.x = 0.15 + (r.anim.moving ? 0.35 : 0) + Math.sin(this.clock * 3) * 0.05;
      const orb = m.getObjectByName('orb');
      if (orb) orb.rotation.y += dt * 3;
    }
    const gem = m.getObjectByName('gem');
    if (gem) gem.rotation.y += dt * (r.kind === 'crystal' ? 0.8 : 1.5);
    if (r.kind === 'crystal') {
      for (let i = 0; i < 3; i++) {
        const s = m.getObjectByName('shard' + i);
        const a = this.clock * 1.2 + (i * Math.PI * 2) / 3;
        s.position.set(Math.cos(a) * 2.6, 4 + Math.sin(this.clock * 2 + i) * 0.5, Math.sin(a) * 2.6);
        s.rotation.y += dt * 2;
      }
    }
  }

  updateCorpses(dt) {
    for (const c of this.corpses) {
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      const m = c.r.mesh;
      if (c.hero) {
        if (c.r.alive) { c.done = true; m.rotation.set(0, 0, 0); m.visible = true; continue; }
        m.rotation.x = -Math.min(1, k * 2) * Math.PI / 2 * 0.9;
        m.position.y = -k * 0.3;
        if (k >= 1) { m.visible = false; c.done = true; }
      } else if (c.keep) {
        m.position.y = -k * (c.r.kind === 'crystal' ? 3 : 4.5);
        m.rotation.z = k * 0.15;
        if (k >= 1) { c.done = true; m.scale.y = 0.3; m.position.y = -0.5; }
      } else {
        m.position.y = -k * 1.2;
        m.rotation.z = k * 1.2;
        if (k >= 1) { c.done = true; this.scene.remove(m); }
      }
    }
    if (this.corpses.length) this.corpses = this.corpses.filter((c) => !c.done);
  }

  updateAuras(r) {
    if (!r.auras) {
      r.auras = {};
      for (const [id, [col, rad]] of Object.entries(AURAS)) {
        const m = new THREE.Mesh(
          new THREE.RingGeometry(rad - 0.12, rad, 40, 1, 0, Math.PI * 1.6),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.y = 0.08;
        r.mesh.add(m);
        r.auras[id] = m;
      }
    }
    let i = 0;
    for (const [id, m] of Object.entries(r.auras)) {
      m.visible = r.hasBuff(id);
      m.rotation.z = this.clock * (2 + i++) * (i % 2 ? 1 : -1);
    }
  }

  // ---------- 投射物 ----------
  updateProjectiles() {
    for (const [id, p] of this.world.proj) {
      let m = this.projMeshes.get(id);
      if (p.gone) {
        if (m) { this.scene.remove(m); m.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); this.projMeshes.delete(id); }
        this.world.proj.delete(id);
        continue;
      }
      if (!m) {
        if (p.skill) {
          const geo = p.arrow ? new THREE.BoxGeometry(0.25, 0.25, 1.8) : new THREE.IcosahedronGeometry(p.size, 1);
          m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: p.color }));
          m.add(new THREE.Mesh(new THREE.SphereGeometry(p.size * 2.2, 10, 8), new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })));
        } else {
          const geo = p.arrow ? new THREE.BoxGeometry(0.08, 0.08, 0.9) : new THREE.SphereGeometry(p.size, 8, 6);
          m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: p.color }));
        }
        this.scene.add(m);
        this.projMeshes.set(id, m);
      }
      m.position.set(p.x, p.y, p.z);
      m.rotation.y = p.yaw;
      if (p.skill && !p.arrow) m.rotation.x += 0.1;
    }
  }

  // ---------- 每帧 ----------
  render(dt) {
    this.clock += dt;
    const w = this.world, p = w.me;
    if (!p) { this.renderer.render(this.scene, this.camera); return; }
    for (const r of w.units) {
      if (r.kind === 'hero') {
        if (!r.alive) continue;
        r.mesh.visible = !r.hidden;
        const ring = r.mesh.getObjectByName('ring');
        if (ring) ring.material.opacity = r.inBush >= 0 ? 0.35 : 0.8;
        this.updateAuras(r);
        // 回城光柱
        const beam = this.recallFx.get(r.id);
        if (r.recall && !r.hidden && (!beam || beam.dead)) this.recallFx.set(r.id, this.fx.recallBeam(r));
        if (!r.recall && beam) { beam.remove(); this.recallFx.delete(r.id); }
      }
      if (r.alive) this.syncMesh(r, dt);
    }
    this.map.bushMat.opacity = p.alive && p.inBush >= 0 ? 0.55 : 1;

    // 防御塔警示与锁定线
    for (const { r, ring } of this.towerRings) {
      ring.visible = r.alive && p.alive && p.edgeDist(r) < r.stats.range + 5;
      if (ring.visible) ring.material.opacity = r.targetId === p.id ? 0.85 : 0.4;
      const b = this.beams.get(r.id);
      if (r.alive && r.targetId === p.id && (!b || b.dead)) {
        this.beams.set(r.id, this.fx.beam(r, p, 0xff3030));
        r.target = p;
      }
      if (r.targetId !== p.id) r.target = null;
    }

    this.updateProjectiles();
    this.updateCorpses(dt);
    this.fx.update(dt);
    const water = this.map.group.userData.water;
    if (water) water.material.emissiveIntensity = 0.3 + Math.sin(this.clock * 2) * 0.1;

    // 摄像机
    const focus = this.endFocus || p;
    const lerp = 1 - Math.exp(-dt * (this.endFocus ? 2 : 10));
    this.camTarget.x += (focus.x - this.camTarget.x) * lerp;
    this.camTarget.z += (focus.z - this.camTarget.z) * lerp;
    const cam = this.camera;
    cam.position.copy(this.camTarget).add(this.camOffsetWorld());
    if (this.shakeAmp > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shakeAmp;
      cam.position.y += (Math.random() - 0.5) * this.shakeAmp;
      this.shakeAmp = Math.max(0, this.shakeAmp - dt * 2.5);
    }
    cam.lookAt(this.camTarget);
    this.sun.position.set(this.camTarget.x - 18, 34, this.camTarget.z + 14);
    this.sun.target.position.copy(this.camTarget);

    this.renderer.render(this.scene, cam);
    this.ui.updateHud(dt);
    document.body.classList.toggle('dead-gray', !p.alive && !this.c.over);
  }

  destroy() {
    window.removeEventListener('resize', this.onResize);
    this.ui.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    document.body.classList.remove('dead-gray');
  }
}
