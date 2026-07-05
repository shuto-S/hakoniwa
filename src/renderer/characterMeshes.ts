// キャラクターの見た目。モデルはすべて +Z が正面。
// maker は character(job / variant を参照)を受け取る。
import * as THREE from 'three';

interface Character {
  job?: string;
  variant?: string;
}

const SHIRT_COLORS = [0xe6704b, 0x4b8fe6, 0x53b86a, 0xd9a441, 0x9a6fd0];
const CAT_COLORS = [0x3a3a3a, 0xd9a441, 0xe8e2d4, 0x8a7a6a];

function part(
  geometry: THREE.BufferGeometry,
  color: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function makeVillagerMesh(character: Character): THREE.Group {
  const group = new THREE.Group();
  const shirt = SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)];
  group.add(part(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6), 0x5a4632, -0.05, 0.05, 0));
  group.add(part(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6), 0x5a4632, 0.05, 0.05, 0));
  group.add(part(new THREE.CylinderGeometry(0.1, 0.12, 0.22, 6), shirt, 0, 0.21, 0));
  group.add(part(new THREE.SphereGeometry(0.1, 8, 6), 0xf0c8a0, 0, 0.42, 0));

  // しごとで持ちものと帽子が変わる
  if (character.job === 'farmer') {
    group.add(part(new THREE.ConeGeometry(0.19, 0.08, 8), 0xd9c27a, 0, 0.5, 0)); // 麦わら帽子
  } else if (character.job === 'lumberjack') {
    group.add(part(new THREE.CylinderGeometry(0.09, 0.1, 0.05, 6), 0x5a4632, 0, 0.51, 0)); // 帽子
    const handle = part(
      new THREE.CylinderGeometry(0.014, 0.014, 0.3, 4),
      0x8a6a42,
      0.15,
      0.24,
      0.04,
    );
    handle.rotation.z = 0.35;
    group.add(handle);
    group.add(part(new THREE.BoxGeometry(0.07, 0.05, 0.02), 0x9a9aa2, 0.2, 0.36, 0.04)); // 斧
  } else if (character.job === 'fisher') {
    group.add(part(new THREE.ConeGeometry(0.11, 0.12, 6), shirt, 0, 0.53, 0));
    const rod = part(new THREE.CylinderGeometry(0.008, 0.008, 0.45, 4), 0x6a5236, 0.13, 0.35, 0.12);
    rod.rotation.x = -0.9;
    group.add(rod);
  } else {
    group.add(part(new THREE.ConeGeometry(0.11, 0.12, 6), shirt, 0, 0.53, 0));
  }
  return group;
}

function makeSheepMesh(character: Character): THREE.Group {
  const wool = character.variant === 'black' ? 0x3c3833 : 0xf2efe6;
  const group = new THREE.Group();
  for (const [x, z] of [
    [-0.08, -0.07],
    [0.08, -0.07],
    [-0.08, 0.07],
    [0.08, 0.07],
  ]) {
    group.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 5), 0x4a4040, x, 0.05, z));
  }
  const body = part(new THREE.SphereGeometry(0.15, 8, 6), wool, 0, 0.2, 0);
  body.scale.set(1, 0.85, 1.25);
  group.add(body);
  group.add(part(new THREE.BoxGeometry(0.11, 0.11, 0.1), 0x4a4040, 0, 0.24, 0.19));
  group.add(part(new THREE.SphereGeometry(0.07, 6, 5), wool, 0, 0.31, 0.13));
  return group;
}

function makeChickenMesh(): THREE.Group {
  const group = new THREE.Group();
  const body = part(new THREE.SphereGeometry(0.1, 8, 6), 0xfaf7ef, 0, 0.12, 0);
  body.scale.set(0.9, 1, 1.15);
  group.add(body);
  group.add(part(new THREE.SphereGeometry(0.06, 6, 5), 0xfaf7ef, 0, 0.24, 0.06));
  group.add(
    part(new THREE.ConeGeometry(0.025, 0.06, 4), 0xe8a33d, 0, 0.24, 0.14).rotateX(Math.PI / 2),
  );
  group.add(part(new THREE.BoxGeometry(0.02, 0.05, 0.04), 0xd8453c, 0, 0.31, 0.05));
  return group;
}

// 旅人: マップを通り過ぎていく、蓑と笠のひと
function makeTravelerMesh(): THREE.Group {
  const group = new THREE.Group();
  group.add(part(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6), 0x4a3f30, -0.05, 0.05, 0));
  group.add(part(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6), 0x4a3f30, 0.05, 0.05, 0));
  group.add(part(new THREE.CylinderGeometry(0.09, 0.14, 0.24, 6), 0x8a7f6a, 0, 0.22, 0));
  group.add(part(new THREE.SphereGeometry(0.09, 8, 6), 0xe8bd93, 0, 0.42, 0));
  group.add(part(new THREE.ConeGeometry(0.17, 0.09, 8), 0xb09a5f, 0, 0.51, 0));
  group.add(part(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 4), 0x6a5236, 0.14, 0.25, 0.03));
  return group;
}

// しか(低確率の訪問者)
function makeDeerMesh(): THREE.Group {
  const group = new THREE.Group();
  for (const [x, z] of [
    [-0.07, -0.09],
    [0.07, -0.09],
    [-0.07, 0.09],
    [0.07, 0.09],
  ]) {
    group.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 4), 0x7a5236, x, 0.08, z));
  }
  const body = part(new THREE.SphereGeometry(0.13, 8, 6), 0x9a6b42, 0, 0.22, 0);
  body.scale.set(0.85, 0.8, 1.3);
  group.add(body);
  const neck = part(new THREE.CylinderGeometry(0.04, 0.05, 0.16, 5), 0x9a6b42, 0, 0.34, 0.13);
  neck.rotation.x = -0.4;
  group.add(neck);
  group.add(part(new THREE.SphereGeometry(0.06, 6, 5), 0x9a6b42, 0, 0.44, 0.18));
  // つの
  for (const side of [-1, 1]) {
    const antler = part(
      new THREE.CylinderGeometry(0.008, 0.012, 0.14, 4),
      0xd9c8a8,
      side * 0.04,
      0.54,
      0.15,
    );
    antler.rotation.z = side * 0.5;
    group.add(antler);
  }
  return group;
}

// ねこ(低確率の訪問者)
function makeCatMesh(): THREE.Group {
  const fur = CAT_COLORS[Math.floor(Math.random() * CAT_COLORS.length)];
  const group = new THREE.Group();
  const body = part(new THREE.SphereGeometry(0.09, 8, 6), fur, 0, 0.1, 0);
  body.scale.set(0.9, 0.8, 1.3);
  group.add(body);
  group.add(part(new THREE.SphereGeometry(0.06, 6, 5), fur, 0, 0.19, 0.1));
  for (const side of [-1, 1]) {
    group.add(part(new THREE.ConeGeometry(0.02, 0.05, 4), fur, side * 0.035, 0.26, 0.09));
  }
  const tail = part(new THREE.CylinderGeometry(0.012, 0.018, 0.18, 4), fur, 0, 0.16, -0.13);
  tail.rotation.x = 0.9;
  group.add(tail);
  return group;
}

export const MAKERS = {
  villager: makeVillagerMesh,
  sheep: makeSheepMesh,
  chicken: makeChickenMesh,
  traveler: makeTravelerMesh,
  deer: makeDeerMesh,
  cat: makeCatMesh,
};
