import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
// Render the project's actual pets with a transparent background for the UI.
export async function renderPortrait(url) {
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(800, 800);
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const light = new THREE.DirectionalLight(0xffffff, 2.2);
  light.position.set(2, 4, 4);
  scene.add(light);
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  const gltf = await loader.loadAsync(url);
  const root = gltf.userData.vrm.scene;
  scene.add(root);
  if (url.includes("minidog"))
    root.traverse((object) => {
      if (!object.isMesh) return;
      const mats = Array.isArray(object.material)
        ? object.material
        : [object.material];
      const clay = mats.map(
        (mat) =>
          new THREE.MeshStandardMaterial({
            map: mat.map,
            color: 0xd9d4e1,
            roughness: 0.8,
            side: mat.side,
          }),
      );
      object.material = Array.isArray(object.material) ? clay : clay[0];
    });
  root.traverse((object) => {
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    materials.filter(Boolean).forEach((mat) => {
      if (mat.shadeColorFactor && mat.shadeColorFactor.r > 0.9)
        mat.shadeColorFactor.setHex(0x96909f);
      if (mat.shadeMultiplyTexture && mat.name === "body")
        mat.shadeMultiplyTexture = null;
    });
  });
  root.rotation.y = 0.28;
  const box = new THREE.Box3().setFromObject(root),
    size = box.getSize(new THREE.Vector3()),
    center = box.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const distance =
    (Math.max(size.y, size.x) / (2 * Math.tan(Math.PI / 12))) * 1.1;
  camera.position.set(center.x, center.y + size.y * 0.06, center.z + distance);
  camera.lookAt(center);
  renderer.render(scene, camera);
  const png = canvas.toDataURL("image/png");
  VRMUtils.deepDispose(root);
  renderer.dispose();
  return png;
}
