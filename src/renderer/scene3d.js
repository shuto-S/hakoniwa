import * as THREE from 'three';
import {
  BLOCK_TYPES,
  FLOWER_COLORS,
  HEX_RADIUS,
  BLOCK_HEIGHT,
} from './config.js';

const ELEVATION = THREE.MathUtils.degToRad(38); // 斜め上視点の仰角
const CAMERA_DISTANCE = 40;

export class SceneView {
  constructor(container, world) {
    this.container = container;
    this.world = world;
    this.azimuth = Math.PI / 6;
    this.azimuthTarget = this.azimuth;
    this.zoom = 1;
    // 季節で葉と草の色が変わる(main が季節の変わり目に更新する)
    this.seasonColors = { leaves: BLOCK_TYPES.leaves.color, grass: BLOCK_TYPES.grass.color };
    this.nightGlow = 0; // 夜の家あかりの強さ(0〜1、main が毎フレーム設定)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfff3dd, 1.9);
    this.sun.position.set(6, 14, 4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(this.sun);

    // デスクトップの上に影だけ落とす床
    this.shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: 0.28 })
    );
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.position.y = -0.01;
    this.shadowPlane.receiveShadow = true;
    this.scene.add(this.shadowPlane);

    this.buildInstancedMeshes();
    this.buildGhost();

    this.raycaster = new THREE.Raycaster();
    this.resize();
    this.fitCameraToWorld();
    this.rebuild();
  }

  hexGeometry(radiusScale, height) {
    return new THREE.CylinderGeometry(
      HEX_RADIUS * radiusScale,
      HEX_RADIUS * radiusScale,
      height,
      6
    );
  }

  buildInstancedMeshes() {
    const capacity = this.world.cols * this.world.rows * (this.world.maxHeight + 1);

    const solidMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.9,
      metalness: 0,
      flatShading: true,
    });
    this.solidMesh = new THREE.InstancedMesh(
      this.hexGeometry(0.985, BLOCK_HEIGHT),
      solidMaterial,
      capacity
    );
    this.solidMesh.castShadow = true;
    this.solidMesh.receiveShadow = true;

    const waterMaterial = new THREE.MeshStandardMaterial({
      color: BLOCK_TYPES.water.color,
      roughness: 0.25,
      metalness: 0,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    // 水も積み重ねられるので、上限は不透明ブロックと同じにする
    this.waterMesh = new THREE.InstancedMesh(
      this.hexGeometry(0.985, BLOCK_HEIGHT * 0.82),
      waterMaterial,
      capacity
    );

    // 花とたきびは数が少ないので、インスタンシングせず細かいモデルを組む
    this.flowerGroup = new THREE.Group();
    this.campfireGroup = new THREE.Group();
    this.campfires = [];

    // 夜、家の入口にともるあかり
    this.hutLightGroup = new THREE.Group();
    this.hutLights = [];

    this.scene.add(
      this.solidMesh,
      this.waterMesh,
      this.flowerGroup,
      this.campfireGroup,
      this.hutLightGroup
    );
    // instanceId → マス の対応表(クリック判定用)
    this.solidInfo = [];
    this.waterInfo = [];

    if (!this.decor) this.buildDecorAssets();
  }

  // 花・たきび用の共有ジオメトリとマテリアル(setWorld をまたいで使い回す)
  buildDecorAssets() {
    const standard = (color, extra = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...extra });
    this.decor = {
      // 花
      stemGeo: new THREE.CylinderGeometry(0.015, 0.022, 0.22, 5),
      leafGeo: new THREE.SphereGeometry(0.035, 5, 4),
      petalGeo: new THREE.SphereGeometry(0.045, 6, 5),
      centerGeo: new THREE.SphereGeometry(0.032, 6, 5),
      stemMat: standard(0x4a8f3c),
      leafMat: standard(0x5aa348),
      centerMat: standard(0xf2cf4e, { roughness: 0.7 }),
      petalMats: FLOWER_COLORS.map((c) => standard(c, { roughness: 0.8 })),
      // たきび
      logGeo: new THREE.CylinderGeometry(0.035, 0.035, 0.42, 5),
      stoneGeo: new THREE.IcosahedronGeometry(0.05, 0),
      flameOuterGeo: new THREE.ConeGeometry(0.15, 0.34, 6),
      flameInnerGeo: new THREE.ConeGeometry(0.085, 0.2, 6),
      smokeGeo: new THREE.SphereGeometry(0.06, 6, 5),
      logMat: standard(0x6a4a2e, { roughness: 1 }),
      charMat: standard(0x3a3230, { roughness: 1 }),
      stoneMat: standard(0x8f8f96),
      flameOuterMat: new THREE.MeshBasicMaterial({
        color: 0xf27d2a,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
      flameInnerMat: new THREE.MeshBasicMaterial({
        color: 0xf7d154,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
      smokeMats: [], // 煙は個別に透明度を動かすためキャッシュして使い回す
      // 作物(はたけの上のこむぎ)
      cropGeos: [
        new THREE.CylinderGeometry(0.012, 0.016, 0.1, 4), // 芽
        new THREE.CylinderGeometry(0.014, 0.018, 0.22, 4), // 育ちざかり
        new THREE.CylinderGeometry(0.016, 0.02, 0.26, 4), // 実り
      ],
      cropMats: [standard(0x76c24e), standard(0x5aa348), standard(0xd9b64a)],
    };
  }

  makeCrop(x, y, z, stage) {
    const d = this.decor;
    const group = new THREE.Group();
    const offsets = [
      [0, 0], [0.13, 0.08], [-0.12, 0.1], [0.08, -0.13], [-0.09, -0.11],
    ];
    const count = stage === 0 ? 3 : 5;
    for (let i = 0; i < count; i++) {
      const stalk = new THREE.Mesh(d.cropGeos[stage], d.cropMats[stage]);
      const [ox, oz] = offsets[i];
      stalk.position.set(ox, d.cropGeos[stage].parameters.height / 2, oz);
      stalk.rotation.z = (i - 1) * 0.08;
      group.add(stalk);
    }
    group.position.set(x, y, z);
    return group;
  }

  smokeMaterial(index) {
    const mats = this.decor.smokeMats;
    if (!mats[index]) {
      mats[index] = new THREE.MeshBasicMaterial({
        color: 0xbfc3c9,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
    }
    return mats[index];
  }

  makeFlower(x, y, z, colorIndex) {
    const d = this.decor;
    const group = new THREE.Group();

    const stem = new THREE.Mesh(d.stemGeo, d.stemMat);
    stem.position.y = 0.11;
    group.add(stem);

    const leaf = new THREE.Mesh(d.leafGeo, d.leafMat);
    leaf.position.set(0.035, 0.09, 0);
    leaf.scale.set(1.4, 0.4, 0.8);
    group.add(leaf);

    // 中心のまわりに5枚の花びら
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const petal = new THREE.Mesh(d.petalGeo, d.petalMats[colorIndex % d.petalMats.length]);
      petal.position.set(Math.cos(angle) * 0.055, 0.235, Math.sin(angle) * 0.055);
      petal.scale.set(1, 0.55, 1);
      petal.castShadow = true;
      group.add(petal);
    }
    const center = new THREE.Mesh(d.centerGeo, d.centerMat);
    center.position.y = 0.245;
    group.add(center);

    group.position.set(x, y, z);
    group.rotation.y = colorIndex * 1.3; // 向きに個体差を
    return group;
  }

  makeCampfire(x, y, z, index) {
    const d = this.decor;
    const group = new THREE.Group();

    // 石のかこい
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + 0.26;
      const stone = new THREE.Mesh(d.stoneGeo, d.stoneMat);
      stone.position.set(Math.cos(angle) * 0.31, 0.03, Math.sin(angle) * 0.31);
      stone.scale.set(1 + (i % 3) * 0.15, 0.75, 1 + ((i + 1) % 2) * 0.2);
      stone.rotation.y = i * 1.1;
      stone.castShadow = true;
      group.add(stone);
    }

    // 組んだ薪(3本交差、中心は焦げた薪)
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(d.logGeo, i === 0 ? d.charMat : d.logMat);
      log.rotation.z = Math.PI / 2 - 0.18; // 横倒しにして端を持ち上げる
      log.rotation.y = (i / 3) * Math.PI;
      log.position.y = 0.06 + i * 0.015;
      log.castShadow = true;
      group.add(log);
    }

    // 炎(外側と芯の二層)
    const outer = new THREE.Mesh(d.flameOuterGeo, d.flameOuterMat);
    outer.position.y = 0.28;
    const inner = new THREE.Mesh(d.flameInnerGeo, d.flameInnerMat);
    inner.position.y = 0.21;
    group.add(outer, inner);

    // けむり(3つのループする煙玉)
    const smokes = [];
    for (let j = 0; j < 3; j++) {
      const smoke = new THREE.Mesh(d.smokeGeo, this.smokeMaterial(index * 3 + j));
      smokes.push(smoke);
      group.add(smoke);
    }

    // 最初の数個だけ、夜に効くあかりを灯す
    let light = null;
    if (index < 3) {
      light = new THREE.PointLight(0xf29a4a, 3.5, 3.2, 2);
      light.position.y = 0.4;
      group.add(light);
    }

    group.position.set(x, y, z);
    this.campfires.push({ outer, inner, smokes, light, phase: index * 1.7 });
    return group;
  }

  buildGhost() {
    this.ghost = new THREE.Mesh(
      this.hexGeometry(1.0, BLOCK_HEIGHT),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false })
    );
    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  setWorld(world) {
    this.world = world;
    this.scene.remove(
      this.solidMesh,
      this.waterMesh,
      this.flowerGroup,
      this.campfireGroup,
      this.hutLightGroup
    );
    for (const mesh of [this.solidMesh, this.waterMesh]) {
      mesh.dispose(); // インスタンス属性
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.buildInstancedMeshes();
    this.fitCameraToWorld();
    this.rebuild();
  }

  rebuild() {
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    let solidCount = 0;
    let waterCount = 0;
    this.solidInfo.length = 0;
    this.waterInfo.length = 0;

    // 冬は水面が氷になる
    const frozen = this.world.frozen;
    this.waterMesh.material.color.setHex(frozen ? 0xcfeaf5 : BLOCK_TYPES.water.color);
    this.waterMesh.material.opacity = frozen ? 0.95 : 0.72;
    this.waterMesh.material.roughness = frozen ? 0.15 : 0.25;

    for (const [col, row] of this.world.columns()) {
      const { x, z } = this.world.positionOf(col, row);
      const stack = this.world.stackAt(col, row);
      for (let y = 0; y < stack.length; y++) {
        const type = stack[y];
        if (!type) continue;
        if (BLOCK_TYPES[type].water) {
          matrix.makeTranslation(x, (y + 0.41) * BLOCK_HEIGHT, z);
          this.waterMesh.setMatrixAt(waterCount, matrix);
          this.waterInfo[waterCount] = { col, row };
          waterCount++;
        } else {
          matrix.makeTranslation(x, (y + 0.5) * BLOCK_HEIGHT, z);
          this.solidMesh.setMatrixAt(solidCount, matrix);
          const hex =
            type === 'leaves'
              ? this.seasonColors.leaves
              : type === 'grass'
                ? this.seasonColors.grass
                : BLOCK_TYPES[type].color;
          this.solidMesh.setColorAt(solidCount, color.setHex(hex));
          this.solidInfo[solidCount] = { col, row };
          solidCount++;
        }
      }
    }

    // 花を立て直す
    this.flowerGroup.clear();
    for (const key of this.world.flowers) {
      const [col, row] = key.split(',').map(Number);
      const { x, z } = this.world.positionOf(col, row);
      const colorIndex = (col * 7 + row * 13) % FLOWER_COLORS.length;
      this.flowerGroup.add(
        this.makeFlower(x, this.world.topSurfaceY(col, row), z, colorIndex)
      );
    }

    // 作物を立て直す(花と同じグループに)
    for (const [key, crop] of this.world.crops) {
      const [col, row] = key.split(',').map(Number);
      const { x, z } = this.world.positionOf(col, row);
      this.flowerGroup.add(this.makeCrop(x, this.world.topSurfaceY(col, row), z, crop.stage));
    }

    // 家のあかりを立て直す(最初の3軒だけ)
    this.hutLightGroup.clear();
    this.hutLights = [];
    for (const [col, row] of this.world.hutCenters().slice(0, 3)) {
      const { x, z } = this.world.positionOf(col, row);
      const light = new THREE.PointLight(0xf2c66b, 0, 2.6, 2);
      light.position.set(x, this.world.topSurfaceY(col, row) - BLOCK_HEIGHT, z);
      this.hutLightGroup.add(light);
      this.hutLights.push(light);
    }

    // たきびを立て直す(露出しているたきびの上に組む)
    this.campfireGroup.clear();
    this.campfires.length = 0;
    for (const [col, row] of this.world.columns()) {
      if (this.world.topType(col, row) !== 'campfire') continue;
      if (this.campfires.length >= 24) break; // 置きすぎ対策
      const { x, z } = this.world.positionOf(col, row);
      const y = this.world.topSurfaceY(col, row);
      this.campfireGroup.add(this.makeCampfire(x, y, z, this.campfires.length));
    }

    this.solidMesh.count = solidCount;
    this.waterMesh.count = waterCount;
    this.solidMesh.instanceMatrix.needsUpdate = true;
    this.waterMesh.instanceMatrix.needsUpdate = true;
    if (this.solidMesh.instanceColor) this.solidMesh.instanceColor.needsUpdate = true;
    // 古い境界球のままだと、高く積んだブロックがレイキャストに当たらない
    this.solidMesh.boundingSphere = null;
    this.waterMesh.boundingSphere = null;
  }

  fitCameraToWorld() {
    const spanX = this.world.cols * HEX_RADIUS * Math.sqrt(3);
    const spanZ = this.world.rows * HEX_RADIUS * 1.5;
    this.viewSize = Math.max(spanX, spanZ) * 0.62 + 1.5;
    const planeSpan = Math.max(spanX, spanZ) + 6;
    this.shadowPlane.scale.set(planeSpan, planeSpan, 1);
    const s = Math.max(spanX, spanZ) * 0.8 + 2;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.camera.far = 100;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.resize();
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height);
    const aspect = width / height;
    this.camera.left = -this.viewSize * aspect;
    this.camera.right = this.viewSize * aspect;
    this.camera.top = this.viewSize;
    this.camera.bottom = -this.viewSize;
    this.camera.updateProjectionMatrix();
  }

  setShadows(enabled) {
    this.sun.castShadow = enabled;
    this.shadowPlane.visible = enabled;
  }

  rotate(steps) {
    this.azimuthTarget += (Math.PI / 3) * steps;
  }

  addZoom(delta) {
    this.zoom = THREE.MathUtils.clamp(this.zoom * (1 - delta * 0.001), 0.5, 3);
  }

  update(dt) {
    this.time = (this.time || 0) + dt;

    // 水面のゆらぎ(凍っているときは止まる)
    this.waterMesh.position.y = this.world.frozen ? 0 : Math.sin(this.time * 1.6) * 0.02;

    // 夜、家のあかりがゆっくりともる
    for (const light of this.hutLights) {
      const target = this.nightGlow * 2.2;
      light.intensity += (target - light.intensity) * Math.min(1, dt * 2);
    }

    // たきび: 炎のゆらめき・煙の立ちのぼり・あかりのちらつき
    const t = this.time;
    for (const cf of this.campfires) {
      const flicker = 1 + Math.sin(t * 9 + cf.phase) * 0.15;
      cf.outer.scale.set(flicker, 1 + Math.sin(t * 7 + cf.phase) * 0.12, flicker);
      const innerFlicker = 1 + Math.sin(t * 11 + cf.phase + 1.3) * 0.18;
      cf.inner.scale.set(innerFlicker, 1 + Math.sin(t * 8 + cf.phase + 0.7) * 0.15, innerFlicker);
      if (cf.light) {
        cf.light.intensity = 3.5 * (0.85 + 0.12 * Math.sin(t * 11 + cf.phase) + 0.06 * Math.sin(t * 23));
      }
      cf.smokes.forEach((smoke, j) => {
        const cycle = (t * 0.3 + j / 3 + cf.phase * 0.1) % 1;
        smoke.position.set(
          Math.sin(t * 0.8 + j * 2.1) * 0.06,
          0.5 + cycle * 0.95,
          Math.cos(t * 0.7 + j * 1.4) * 0.06
        );
        smoke.scale.setScalar(0.6 + cycle * 1.3);
        smoke.material.opacity = 0.3 * Math.sin(cycle * Math.PI); // ふわっと出てふわっと消える
      });
    }

    // 60度単位の回転をなめらかに追従
    const diff = this.azimuthTarget - this.azimuth;
    this.azimuth += diff * Math.min(1, dt * 8);
    if (Math.abs(diff) < 0.0005) this.azimuth = this.azimuthTarget;

    const lookY = (this.world.maxHeight * BLOCK_HEIGHT) / 3;
    this.camera.position.set(
      Math.sin(this.azimuth) * Math.cos(ELEVATION) * CAMERA_DISTANCE,
      Math.sin(ELEVATION) * CAMERA_DISTANCE + lookY,
      Math.cos(this.azimuth) * Math.cos(ELEVATION) * CAMERA_DISTANCE
    );
    this.camera.lookAt(0, lookY, 0);
    this.camera.zoom += (this.zoom - this.camera.zoom) * Math.min(1, dt * 10);
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  // 画面座標からマスを求める。ブロック優先、なければ床平面
  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);

    const hits = this.raycaster.intersectObjects(
      [this.solidMesh, this.waterMesh, this.shadowPlane],
      false
    );
    for (const hit of hits) {
      if (hit.object === this.solidMesh) return { ...this.solidInfo[hit.instanceId] };
      if (hit.object === this.waterMesh) return { ...this.waterInfo[hit.instanceId] };
      const column = this.world.columnAtPoint(hit.point.x, hit.point.z);
      if (column) return column;
    }
    return null;
  }

  // 置き先プレビュー。mode: 'place' | 'remove' | null
  setGhost(column, mode, blockType) {
    if (!column || !mode || !this.world.inBounds(column.col, column.row)) {
      this.ghost.visible = false;
      return;
    }
    const { col, row } = column;
    const { x, z } = this.world.positionOf(col, row);
    if (mode === 'place') {
      const y = this.world.heightAt(col, row);
      if (y >= this.world.maxHeight) {
        this.ghost.visible = false;
        return;
      }
      this.ghost.position.set(x, (y + 0.5) * BLOCK_HEIGHT, z);
      this.ghost.material.color.setHex(BLOCK_TYPES[blockType].color);
      this.ghost.scale.setScalar(1);
    } else {
      const top = this.world.topIndex(col, row);
      if (top < 0) {
        this.ghost.visible = false;
        return;
      }
      this.ghost.position.set(x, (top + 0.5) * BLOCK_HEIGHT, z);
      this.ghost.material.color.setHex(0xe65a5a);
      this.ghost.scale.setScalar(1.06);
    }
    this.ghost.visible = true;
  }
}
