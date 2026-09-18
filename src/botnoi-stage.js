import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

const VISEMES = ["aa", "ih", "ou", "ee", "oh"];

let handle = null;

export function stopPetStage() {
  handle?.stop();
  handle = null;
}

export function setPetSpeaking(speaking) {
  handle?.setSpeaking(Boolean(speaking));
}

function bone(vrm, name) {
  return vrm.humanoid?.getNormalizedBoneNode?.(name) || null;
}

function rememberBase(node, key, value) {
  if (node.userData[key] == null) node.userData[key] = value;
  return node.userData[key];
}

/** Blink, sway, and move the mouth. The paint VRM has expressions but no clip. */
function posePet(vrm, time, speaking, lookTarget) {
  const expr = vrm.expressionManager;
  if (expr) {
    const blinkWindow = time % 4.2;
    const blink = blinkWindow > 3.95 && blinkWindow < 4.12 ? 1 : 0;
    expr.setValue("blink", blink);
    const active = speaking ? VISEMES[Math.floor(time * 8) % VISEMES.length] : null;
    for (const name of VISEMES) expr.setValue(name, name === active ? 1 : 0);
  }

  const hips = bone(vrm, "hips");
  const head = bone(vrm, "head");
  const bob = Math.sin(time * 1.7) * 0.015;
  const sway = Math.sin(time * 0.85) * 0.06;
  if (hips) {
    const baseY = rememberBase(hips, "restY", hips.position.y);
    const baseZ = rememberBase(hips, "restZ", hips.rotation.z);
    hips.position.y = baseY + bob;
    hips.rotation.z = baseZ + sway;
  } else {
    vrm.scene.rotation.z = sway * 0.35;
  }
  if (head) {
    const baseX = rememberBase(head, "restX", head.rotation.x);
    const baseYaw = rememberBase(head, "restYaw", head.rotation.y);
    head.rotation.x = baseX + Math.sin(time * 0.7) * 0.04;
    head.rotation.y = baseYaw + Math.sin(time * 0.45) * (speaking ? 0.05 : 0.1);
  }
  if (vrm.lookAt && lookTarget) {
    vrm.lookAt.target = lookTarget;
    lookTarget.position.set(Math.sin(time * 0.4) * 0.18, 1.35 + Math.sin(time * 0.25) * 0.04, 0.9);
  }
}

/** Show the painted pet while the Botnoi call handles the voice. */
export function startPetStage(container, vrmUrl) {
  stopPetStage();
  if (!container || !vrmUrl || !window.WebGLRenderingContext) return;
  const canvas = document.createElement("canvas");
  canvas.className = "botnoi-stage";
  container.replaceChildren(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 1.2, 2.4);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(1, 2, 2);
  scene.add(key);
  const lookTarget = new THREE.Object3D();
  scene.add(lookTarget);

  let vrm = null;
  let frame = 0;
  let stopped = false;
  let speaking = false;
  let time = 0;
  const clock = new THREE.Clock();
  const resize = () => {
    const width = container.clientWidth || 320;
    const height = container.clientHeight || 480;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  const loop = () => {
    if (stopped) return;
    frame = requestAnimationFrame(loop);
    const delta = clock.getDelta();
    time += delta;
    if (vrm) {
      posePet(vrm, time, speaking, lookTarget);
      vrm.update(delta);
    }
    renderer.render(scene, camera);
  };
  loop();

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.loadAsync(vrmUrl).then((gltf) => {
    if (stopped) {
      VRMUtils.deepDispose(gltf.scene);
      return;
    }
    vrm = gltf.userData.vrm;
    if (!vrm) return;
    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    VRMUtils.removeUnnecessaryJoints(vrm.scene);
    scene.add(vrm.scene);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    vrm.scene.position.sub(center);
    vrm.scene.position.y += size.y / 2;
    camera.position.set(0, size.y * 0.55, Math.max(2.3, size.y * 1.8));
    camera.lookAt(0, size.y * 0.45, 0);
  }).catch(() => {});

  handle = {
    setSpeaking(next) {
      speaking = next;
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      if (vrm) {
        scene.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
      }
      renderer.dispose();
      canvas.remove();
    },
  };
}
