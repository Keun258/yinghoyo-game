// 程序化低模卡通角色工厂：分件骨骼式动画（摆臂/迈步/飞行/金甲发光）+ 英雄配件
import * as THREE from 'three';

function box(w, h, d, color, emissive = 0) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.15, emissive, emissiveIntensity: emissive ? 0.6 : 0 })
  );
  m.castShadow = true;
  return m;
}
function pivotLimb(w, h, d, color) {
  // 原点在肢体顶端，便于绕肩/髋旋转
  const m = box(w, h, d, color);
  m.geometry.translate(0, -h / 2, 0);
  return m;
}

function makeLabel(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 34px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 8;
  ctx.fillStyle = color; ctx.fillText(text, 128, 32);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sp.scale.set(2.6, 0.65, 1);
  return sp;
}

export function makeCharacter(heroId, name, colorHex) {
  const color = new THREE.Color(colorHex);
  const dark = color.clone().multiplyScalar(0.55);
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  // 腿（髋部高 0.55）
  const legL = pivotLimb(0.2, 0.55, 0.22, dark); legL.position.set(-0.16, 0.55, 0);
  const legR = pivotLimb(0.2, 0.55, 0.22, dark); legR.position.set(0.16, 0.55, 0);
  // 躯干
  const torso = box(0.62, 0.68, 0.36, color); torso.position.y = 0.89;
  // 手臂（肩部高 1.15）
  const armL = pivotLimb(0.17, 0.55, 0.19, color); armL.position.set(-0.4, 1.15, 0);
  const armR = pivotLimb(0.17, 0.55, 0.19, color); armR.position.set(0.4, 1.15, 0);
  // 头
  const head = box(0.42, 0.4, 0.4, color.clone().lerp(new THREE.Color('#ffffff'), 0.15));
  head.position.y = 1.45;
  // 枪（挂右手）
  const gun = box(0.1, 0.12, 0.55, new THREE.Color('#222831'), 0);
  gun.position.set(0, -0.5, 0.25);
  armR.add(gun);
  body.add(legL, legR, torso, armL, armR, head);

  const label = makeLabel(name, colorHex);
  label.position.y = 2.05;
  g.add(label);

  const fx = {}; // 附加特效件引用

  // ---- 英雄配件 ----
  if (heroId === 'yinghao') {
    // 皇冠
    const crown = new THREE.Group();
    const band = box(0.46, 0.08, 0.44, new THREE.Color('#ffd700'), 0x664400);
    crown.add(band);
    for (let i = 0; i < 4; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), band.material);
      const a = i / 4 * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.17, 0.11, Math.sin(a) * 0.16);
      crown.add(spike);
    }
    crown.position.y = 1.72;
    body.add(crown);
  } else if (heroId === 'houliu') {
    // 防毒面具：镜片+滤罐
    const maskMat = new THREE.MeshStandardMaterial({ color: 0x2e3b2e, roughness: 0.4 });
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), maskMat);
    face.position.set(0, 1.42, 0.16); face.scale.set(1, 1, 0.6);
    const filter = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.16, 8), maskMat);
    filter.rotation.x = Math.PI / 2; filter.position.set(0, 1.32, 0.3);
    body.add(face, filter);
  } else if (heroId === 'dongdiwen') {
    // 蚊翼 + 触角
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xccddff, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
    const wingGeo = new THREE.PlaneGeometry(0.55, 0.25);
    const wL = new THREE.Mesh(wingGeo, wingMat); wL.position.set(-0.3, 1.2, -0.2); wL.rotation.z = 0.5;
    const wR = new THREE.Mesh(wingGeo, wingMat); wR.position.set(0.3, 1.2, -0.2); wR.rotation.z = -0.5;
    const antMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const aL = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3), antMat);
    aL.position.set(-0.1, 1.75, 0.05); aL.rotation.z = 0.4;
    const aR = aL.clone(); aR.position.x = 0.1; aR.rotation.z = -0.4;
    body.add(wL, wR, aL, aR);
    fx.wings = [wL, wR];
  } else if (heroId === 'dadiwen') {
    // 重甲：肩甲+胸甲加宽
    const armorMat = new THREE.MeshStandardMaterial({ color: 0x33507a, roughness: 0.35, metalness: 0.6 });
    const shL = box(0.24, 0.14, 0.3, armorMat.color, 0); shL.material = armorMat; shL.position.set(-0.42, 1.28, 0);
    const shR = shL.clone(); shR.position.x = 0.42;
    const chest = box(0.7, 0.3, 0.44, armorMat.color, 0); chest.material = armorMat; chest.position.y = 1.05;
    body.add(shL, shR, chest);
  } else if (heroId === 'wangchengxue') {
    // 冰晶法杖（左手）
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b4f2a, roughness: 0.8 }));
    staff.position.set(0, -0.4, 0.1);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.14),
      new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x2288aa, emissiveIntensity: 0.9, roughness: 0.2 }));
    crystal.position.y = 0.62;
    staff.add(crystal);
    armL.add(staff);
    fx.crystal = crystal;
  } else if (heroId === 'zhangjiaxuan') {
    // 金色护肩+腰带
    const gold = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.3, metalness: 0.8 });
    const shL = box(0.26, 0.12, 0.32, gold.color, 0); shL.material = gold; shL.position.set(-0.42, 1.28, 0);
    const shR = shL.clone(); shR.position.x = 0.42;
    const belt = box(0.64, 0.1, 0.38, gold.color, 0); belt.material = gold; belt.position.y = 0.62;
    body.add(shL, shR, belt);
    fx.armorMats = [torso.material, head.material];
  }

  let phase = Math.random() * 10;
  const state = {
    group: g, body, fx, label,
    update(dt, opt) {
      // opt: {moving, speed, flying, armorOn, dead}
      phase += dt * (opt.moving ? 9 : 2);
      if (opt.dead) {
        body.rotation.x = Math.min(Math.PI / 2, (body.rotation.x || 0) + dt * 5);
        body.position.y = Math.max(-0.9, (body.position.y || 0) - dt * 1.5);
        label.visible = false;
        return;
      }
      body.rotation.x = 0; body.position.y = 0;
      if (opt.flying) {
        legL.rotation.x = 0.4 + Math.sin(phase) * 0.1;
        legR.rotation.x = 0.4 + Math.cos(phase) * 0.1;
        body.position.y = Math.sin(phase * 2) * 0.06;
        if (fx.wings) {
          fx.wings[0].rotation.y = Math.sin(phase * 8) * 0.7;
          fx.wings[1].rotation.y = -Math.sin(phase * 8) * 0.7;
        }
      } else if (opt.moving) {
        legL.rotation.x = Math.sin(phase) * 0.7;
        legR.rotation.x = -Math.sin(phase) * 0.7;
        armL.rotation.x = -Math.sin(phase) * 0.55;
        armR.rotation.x = Math.sin(phase) * 0.2 - 0.9; // 持枪手保持前举
        body.position.y = Math.abs(Math.sin(phase)) * 0.05;
      } else {
        legL.rotation.x = legR.rotation.x = 0;
        armL.rotation.x = Math.sin(phase * 0.5) * 0.06;
        armR.rotation.x = -0.9; // 持枪待机
        body.position.y = Math.sin(phase * 0.5) * 0.02;
      }
      if (fx.wings && !opt.flying) { fx.wings[0].rotation.y = 0.2; fx.wings[1].rotation.y = -0.2; }
      // 金甲发光
      if (fx.armorMats) for (const m of fx.armorMats) {
        m.emissive = new THREE.Color(opt.armorOn ? 0xaa8800 : 0x000000);
        m.emissiveIntensity = opt.armorOn ? 0.9 : 0;
      }
    },
  };
  return state;
}

// 大帝汶的卫蚊哨戒炮
export function makeSentry() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x33507a, roughness: 0.5 }));
  base.position.y = 0.15; base.castShadow = true;
  const headM = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x4da6ff, emissive: 0x1133aa, emissiveIntensity: 0.7 }));
  headM.position.y = 0.75; headM.castShadow = true;
  // 环绕蚊群
  const swarm = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5),
      new THREE.MeshStandardMaterial({ color: 0x222222 }));
    swarm.add(m);
  }
  swarm.position.y = 0.75;
  g.add(base, headM, swarm);
  let t = 0;
  return {
    group: g,
    update(dt) {
      t += dt * 6;
      swarm.children.forEach((m, i) => {
        const a = t + i * 1.26;
        m.position.set(Math.cos(a) * 0.45, Math.sin(t * 1.7 + i) * 0.12, Math.sin(a) * 0.45);
      });
    },
  };
}

// 搏击操播放器（包）
export function makeBomb() {
  const g = new THREE.Group();
  const bodyM = box(0.5, 0.35, 0.35, new THREE.Color('#d44'), 0x550000);
  bodyM.position.y = 0.2;
  const speaker = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 12),
    new THREE.MeshStandardMaterial({ color: 0x222222 }));
  speaker.rotation.x = Math.PI / 2; speaker.position.set(0, 0.2, 0.19);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.05),
    new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1 }));
  led.position.set(0.18, 0.42, 0);
  g.add(bodyM, speaker, led);
  let t = 0;
  return {
    group: g,
    update(dt, urgent) {
      t += dt * (urgent ? 10 : 3);
      led.material.emissiveIntensity = (Math.sin(t * 4) + 1) / 2 * 1.5 + 0.3;
    },
  };
}
