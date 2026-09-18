import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

let handle = null;

export function stopPetStage() {
  handle?.stop();
  handle = null;
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

  let vrm = null;
  let frame = 0;
  let stopped = false;
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
    if (vrm) vrm.update(clock.getDelta());
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
