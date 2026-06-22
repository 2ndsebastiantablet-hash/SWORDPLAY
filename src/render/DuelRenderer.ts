import * as THREE from "three";
import { sub, length, normalize, scale, add, vec2, dot, fromAngle, perpendicularRight, type Vec2 } from "../game/math";
import { perfectParryStaggerSeconds } from "../game/combat";
import type { DuelState, FighterId, FighterState, ImpactEvent } from "../game/types";
import {
  RAGDOLL_NODE_NAMES,
  applyRagdollVisualImpact,
  applySwordRecoilToHands,
  bowlingPinBodyHeight,
  bowlingPinBodyRadius,
  bowlingPinHeadRadius,
  createRagdollFighter,
  getSwordGripTargets,
  updateRagdollPhysics,
  type RagdollFighter,
  type RagdollVector,
} from "./ragdollPhysics";

export {
  RAGDOLL_NODE_NAMES as ACTIVE_RAGDOLL_NODE_NAMES,
} from "./ragdollPhysics";

type FighterVisual = {
  ragdoll: RagdollFighter;
  bodyGroup: THREE.Group;
  body: THREE.Mesh;
  faceLeftEye: THREE.Mesh;
  faceRightEye: THREE.Mesh;
  faceMouth: THREE.Mesh;
  leftFootStub: THREE.Mesh;
  rightFootStub: THREE.Mesh;
  leftHand: THREE.Mesh;
  rightHand: THREE.Mesh;
  blade: THREE.Mesh;
  guard: THREE.Mesh;
  shadow: THREE.Mesh;
};

type LiveImpact = {
  group: THREE.Group;
  life: number;
  maxLife: number;
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);

function toWorld(v: Vec2, y = 0): THREE.Vector3 {
  return new THREE.Vector3(v.x, y, v.y);
}

function vectorToThree(v: RagdollVector): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function midpoint(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
  return a.clone().add(b).multiplyScalar(0.5);
}

function distance2(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function setBetween(object: THREE.Object3D, start: THREE.Vector3, end: THREE.Vector3, roll = 0, radius = 1): void {
  const delta = end.clone().sub(start);
  const size = Math.max(delta.length(), 0.001);
  const direction = delta.clone().normalize();
  object.position.copy(start).add(end).multiplyScalar(0.5);
  object.scale.set(radius, size, radius);
  const align = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, direction);
  const twist = new THREE.Quaternion().setFromAxisAngle(direction, roll);
  object.quaternion.copy(twist.multiply(align));
}

function createPinGeometry(): THREE.LatheGeometry {
  const points = [
    new THREE.Vector2(0.2, 0),
    new THREE.Vector2(bowlingPinBodyRadius * 0.92, 0.12),
    new THREE.Vector2(bowlingPinBodyRadius, 0.46),
    new THREE.Vector2(0.33, 0.92),
    new THREE.Vector2(0.25, 1.18),
    new THREE.Vector2(bowlingPinHeadRadius * 1.2, 1.38),
    new THREE.Vector2(bowlingPinHeadRadius, 1.56),
    new THREE.Vector2(0.04, bowlingPinBodyHeight),
  ];
  return new THREE.LatheGeometry(points, 18);
}

export function computeBalanceTilt(fighter: FighterState, time: number): { x: number; z: number } {
  const missingBalance = Math.max(0, fighter.maxBalance - fighter.balance);
  const targetTilt = missingBalance * 0.005;
  const leanDirection = normalize(fighter.lastKnockbackDirection ?? { x: Math.cos(fighter.facing), y: Math.sin(fighter.facing) });
  let x = -leanDirection.y * targetTilt;
  let z = leanDirection.x * targetTilt;

  if (fighter.staggerSeconds > 0) {
    const intensity = Math.min(1, fighter.staggerSeconds / perfectParryStaggerSeconds);
    const wobble = Math.sin(time * 36) * 0.14 * intensity;
    x += wobble * 0.45;
    z += wobble;
  }

  return { x, z };
}

export class DuelRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 80);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly player: FighterVisual;
  private readonly npc: FighterVisual;
  private readonly impacts: LiveImpact[] = [];
  private readonly cameraTarget = new THREE.Vector3(0, 4.15, -6);
  private readonly lookTarget = new THREE.Vector3(0, 1.1, 0);

  constructor(parent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setClearColor(0x101413, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = "game-canvas";
    parent.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x101413);
    this.scene.fog = new THREE.Fog(0x101413, 10, 28);
    this.setupLights();
    this.createArena();
    this.player = this.createFighter("player", 0x4bd7c8, 0xf3e9cf);
    this.npc = this.createFighter("npc", 0xe45e4f, 0xffd2a6);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  render(state: DuelState, dt: number): void {
    for (const effect of state.effects) {
      this.spawnImpact(effect);
      this.applyImpactToFighters(effect, state);
    }

    this.updateFighter(this.player, state.player, state.elapsed, dt);
    this.updateFighter(this.npc, state.npc, state.elapsed, dt);
    this.updateEffects(dt);
    this.updateCamera(state, dt);
    this.renderer.render(this.scene, this.camera);
  }

  clearEffects(): void {
    for (const effect of this.impacts.splice(0)) {
      this.scene.remove(effect.group);
    }
  }

  private resize(): void {
    const width = this.renderer.domElement.parentElement?.clientWidth || window.innerWidth;
    const height = this.renderer.domElement.parentElement?.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xd7fff5, 0x34271d, 1.5);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff1cf, 3.2);
    key.position.set(-4, 7, -3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 18;
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x63b9ff, 1.2);
    rim.position.set(5, 4, 5);
    this.scene.add(rim);
  }

  private createArena(): void {
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x28302b, roughness: 0.86, metalness: 0.04 });
    const arenaMaterial = new THREE.MeshStandardMaterial({ color: 0x6f7963, roughness: 0.74, metalness: 0.08 });
    const edgeMaterial = new THREE.MeshStandardMaterial({
      color: 0xdcc16f,
      roughness: 0.42,
      metalness: 0.35,
      emissive: 0x2d2100,
      emissiveIntensity: 0.18,
    });
    const dangerMaterial = new THREE.MeshBasicMaterial({ color: 0xff6a4d, transparent: true, opacity: 0.42 });

    const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 96), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.28;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const arena = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.78, 0.42, 112), arenaMaterial);
    arena.position.y = -0.16;
    arena.receiveShadow = true;
    arena.castShadow = true;
    this.scene.add(arena);

    const edge = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.045, 10, 160), edgeMaterial);
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 0.08;
    this.scene.add(edge);

    const warning = new THREE.Mesh(new THREE.TorusGeometry(4.03, 0.018, 8, 128), dangerMaterial);
    warning.rotation.x = Math.PI / 2;
    warning.position.y = 0.105;
    this.scene.add(warning);

    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xd8d1b4, transparent: true, opacity: 0.22 });
    const linePoints: THREE.Vector3[] = [];
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2;
      linePoints.push(new THREE.Vector3(0, 0.115, 0));
      linePoints.push(new THREE.Vector3(Math.cos(angle) * 4.42, 0.115, Math.sin(angle) * 4.42));
    }
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(linePoints), lineMaterial);
    this.scene.add(lines);
  }

  private createFighter(id: FighterId, primary: number, skin: number): FighterVisual {
    const rootOrigin = id === "player" ? new THREE.Vector3(0, 0, -1.55) : new THREE.Vector3(0, 0, 1.55);
    const ragdoll = createRagdollFighter(id, { x: rootOrigin.x, y: rootOrigin.y, z: rootOrigin.z }, id === "player" ? Math.PI / 2 : -Math.PI / 2);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.66, metalness: 0.05 });
    const skinMaterial = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.78 });
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x050505 });
    const bootMaterial = new THREE.MeshStandardMaterial({ color: 0x24201b, roughness: 0.86 });
    const metalMaterial = new THREE.MeshStandardMaterial({ color: 0xe7edf0, roughness: 0.28, metalness: 0.84 });
    const gripMaterial = new THREE.MeshStandardMaterial({ color: 0x2a1d17, roughness: 0.76 });
    const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
    const bodyGroup = new THREE.Group();
    bodyGroup.rotation.order = "YXZ";
    this.scene.add(bodyGroup);

    const body = new THREE.Mesh(createPinGeometry(), bodyMaterial);
    body.castShadow = true;
    body.receiveShadow = true;
    bodyGroup.add(body);

    const eyeGeometry = new THREE.SphereGeometry(0.036, 8, 6);
    const faceLeftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    const faceRightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    faceLeftEye.position.set(-0.085, 1.42, 0.265);
    faceRightEye.position.set(0.085, 1.42, 0.265);
    bodyGroup.add(faceLeftEye, faceRightEye);

    const faceMouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.018, 0.018), eyeMaterial);
    faceMouth.position.set(0, 1.29, 0.285);
    bodyGroup.add(faceMouth);

    const footGeometry = new THREE.CylinderGeometry(0.065, 0.08, 0.3, 8);
    footGeometry.rotateX(Math.PI / 2);
    const leftFootStub = new THREE.Mesh(footGeometry, bootMaterial);
    const rightFootStub = new THREE.Mesh(footGeometry, bootMaterial);
    leftFootStub.castShadow = true;
    rightFootStub.castShadow = true;
    leftFootStub.position.set(-0.15, 0.075, 0.24);
    rightFootStub.position.set(0.15, 0.075, 0.24);
    bodyGroup.add(leftFootStub, rightFootStub);

    const handGeometry = new THREE.SphereGeometry(0.085, 12, 8);
    const leftHand = new THREE.Mesh(handGeometry, skinMaterial);
    const rightHand = new THREE.Mesh(handGeometry, skinMaterial);
    leftHand.castShadow = true;
    rightHand.castShadow = true;
    this.scene.add(leftHand, rightHand);

    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.075, 1, 0.035), metalMaterial);
    blade.castShadow = true;
    this.scene.add(blade);

    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.055, 0.08), gripMaterial);
    guard.castShadow = true;
    this.scene.add(guard);

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.52, 24), shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    this.scene.add(shadow);

    return {
      ragdoll,
      bodyGroup,
      body,
      faceLeftEye,
      faceRightEye,
      faceMouth,
      leftFootStub,
      rightFootStub,
      leftHand,
      rightHand,
      blade,
      guard,
      shadow,
    };
  }

  private applyImpactToFighters(effect: ImpactEvent, state: DuelState): void {
    const applyTo = (visual: FighterVisual, fighter: FighterState) => {
      const distance = distance2(effect.position, fighter.position);
      if (distance > 1.6 && effect.kind !== "clash") return;
      const outward = normalize(sub(fighter.position, effect.position), fighter.lastKnockbackDirection ?? vec2(0, fighter.id === "player" ? -1 : 1));
      const impulse = { x: outward.x, y: effect.kind === "fall" ? -0.1 : 0.18, z: outward.y };
      const force = Math.max(0.08, Math.min(1.6, effect.force * 0.09));

      if (effect.kind === "clash") {
        applySwordRecoilToHands(visual.ragdoll, impulse, force);
      } else {
        applyRagdollVisualImpact(visual.ragdoll, impulse, force);
      }
    };

    applyTo(this.player, state.player);
    applyTo(this.npc, state.npc);
  }

  private updateFighter(visual: FighterVisual, fighter: FighterState, time: number, dt: number): void {
    updateRagdollPhysics(visual.ragdoll, {
      rootPosition: fighter.position,
      facing: fighter.facing,
      velocity: fighter.velocity,
      balance: fighter.balance,
      maxBalance: fighter.maxBalance,
      staggerSeconds: fighter.staggerSeconds,
      falling: fighter.falling,
      fallSeconds: fighter.fallSeconds ?? 0,
      swordHand: fighter.sword.hand,
      swordTip: fighter.sword.tip,
      handHeight: fighter.sword.handHeight ?? 1.08,
      tipHeight: fighter.sword.tipHeight ?? 1.35,
      swordBounceOffset: fighter.sword.bounceOffset ?? vec2(0, 0),
      swordVelocity: fighter.sword.finalVelocity ?? fighter.sword.velocity,
      arenaRadius: 4.5,
      time,
    }, dt);

    const forward = fromAngle(fighter.facing);
    const right = perpendicularRight(forward);
    const yaw = Math.PI / 2 - fighter.facing;
    const bodyLean = fighter.body.visualLean;
    const balanceTilt = computeBalanceTilt(fighter, time);
    const forwardLean = dot(bodyLean, forward);
    const sideLean = dot(bodyLean, right);
    const fallDrop = fighter.falling ? Math.min(1.5, (fighter.fallSeconds ?? 0) * 1.1) : 0;

    visual.bodyGroup.position.set(fighter.position.x, fighter.body.bob - fallDrop, fighter.position.y);
    visual.bodyGroup.rotation.set(
      -forwardLean * 1.8 + balanceTilt.x,
      yaw,
      -sideLean * 1.8 + balanceTilt.z,
    );
    visual.leftFootStub.position.y = 0.075 + fighter.body.leftFootLift;
    visual.rightFootStub.position.y = 0.075 + fighter.body.rightFootLift;

    const leftHand = vectorToThree(visual.ragdoll.nodes.leftHand.position);
    const rightHand = vectorToThree(visual.ragdoll.nodes.rightHand.position);
    visual.leftHand.position.copy(leftHand);
    visual.rightHand.position.copy(rightHand);

    const grips = getSwordGripTargets({
      hand: fighter.sword.hand,
      tip: fighter.sword.tip,
      handHeight: fighter.sword.handHeight ?? 1.08,
      tipHeight: fighter.sword.tipHeight ?? 1.35,
    });
    const hilt = midpoint(leftHand, rightHand);
    const bladeDirection = vectorToThree(grips.bladeDirection).normalize();
    const bladeLength = Math.max(0.72, vectorToThree(grips.tip).distanceTo(vectorToThree(grips.hilt)));
    const tip = hilt.clone().add(bladeDirection.multiplyScalar(bladeLength));
    setBetween(visual.blade, hilt, tip, fighter.sword.roll ?? 0, 1);
    visual.guard.position.copy(hilt.clone().add(tip.clone().sub(hilt).normalize().multiplyScalar(0.1)));
    visual.guard.quaternion.copy(visual.blade.quaternion);
    visual.guard.scale.setScalar(1);

    const speed = length(fighter.velocity);
    const balanceRatio = Math.max(0, Math.min(1, fighter.balance / Math.max(fighter.maxBalance, 1)));
    const instability = 1 - balanceRatio;
    visual.shadow.position.set(fighter.position.x, 0.014, fighter.position.y);
    visual.shadow.scale.set(1 + speed * 0.05, 0.74 + instability * 0.25, 1);
    visual.shadow.visible = !fighter.falling || (fighter.fallSeconds ?? 0) < 1.4;

    void visual.body;
    void visual.faceLeftEye;
    void visual.faceRightEye;
    void visual.faceMouth;
  }

  private spawnImpact(effect: ImpactEvent): void {
    const group = new THREE.Group();
    const hotColor =
      effect.kind === "clash" ? 0xf8df7b : effect.kind === "fall" ? 0xff6a4d : effect.kind === "stagger" ? 0xffc56f : 0xffffff;
    const material = new THREE.MeshBasicMaterial({ color: hotColor, transparent: true, opacity: 0.86 });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.07 + effect.force * 0.015, 10, 8), material);
    group.add(core);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.14, 0.18, 20),
      new THREE.MeshBasicMaterial({ color: hotColor, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    group.position.copy(toWorld(effect.position, effect.height));
    this.scene.add(group);
    this.impacts.push({ group, life: 0.22, maxLife: 0.22 });
  }

  private updateEffects(dt: number): void {
    for (let i = this.impacts.length - 1; i >= 0; i -= 1) {
      const impact = this.impacts[i];
      impact.life -= dt;
      const age = 1 - Math.max(impact.life, 0) / impact.maxLife;
      impact.group.scale.setScalar(1 + age * 2.8);
      impact.group.children.forEach((child) => {
        const mesh = child as THREE.Mesh;
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.opacity = Math.max(0, 0.85 * (1 - age));
      });
      if (impact.life <= 0) {
        this.scene.remove(impact.group);
        this.impacts.splice(i, 1);
      }
    }
  }

  private updateCamera(state: DuelState, dt: number): void {
    const player = state.player.position;
    const npc = state.npc.position;
    const midpointPosition = scale(add(player, npc), 0.5);
    const behind = normalize(sub(player, npc), vec2(0, -1));
    const side = vec2(behind.y, -behind.x);
    const range = Math.min(1.8, Math.max(0, length(sub(player, npc)) - 2.6));
    const desired = toWorld(add(add(player, scale(behind, 5.1 + range)), scale(side, 0.22)), 4.15 + range * 0.24);
    const look = toWorld(midpointPosition, 1.0);
    const smoothing = 1 - Math.exp(-dt * 5.8);
    this.cameraTarget.lerp(desired, smoothing);
    this.lookTarget.lerp(look, smoothing);

    const shake = state.shake;
    const shakeOffset = new THREE.Vector3(
      Math.sin(state.elapsed * 91) * shake * 0.08,
      Math.sin(state.elapsed * 117) * shake * 0.045,
      Math.cos(state.elapsed * 83) * shake * 0.08,
    );
    this.camera.position.copy(this.cameraTarget).add(shakeOffset);
    this.camera.lookAt(this.lookTarget);
  }
}
