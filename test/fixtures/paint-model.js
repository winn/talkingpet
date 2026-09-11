import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import {
  pickPaintIntersection,
  isVisibleTexel,
} from "../../src/projected-paint.js";
// Load the real fixture, independent of the app's pointer event handlers.
export async function locateFaceSamples(rect) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(
    "/assets/minicat/PaintAnimationFaceoldbodyCat96.vrm",
  );
  const vrm = gltf.userData.vrm;
  const root = vrm.scene;
  VRMUtils.removeUnnecessaryVertices(root);
  VRMUtils.removeUnnecessaryJoints(root);
  const box = new THREE.Box3().setFromObject(root),
    center = box.getCenter(new THREE.Vector3()),
    size = box.getSize(new THREE.Vector3());
  root.position.sub(center);
  root.position.y += size.y / 2;
  vrm.update(0);
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.isSkinnedMesh) o.skeleton.update();
  });
  const camera = new THREE.PerspectiveCamera(
    30,
    rect.width / rect.height,
    0.1,
    20,
  );
  camera.position.set(0, size.y * 0.55, Math.max(2.3, size.y * 1.8));
  camera.lookAt(0, size.y * 0.52, 0);
  camera.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const paintable = (name) => ["Head", "body"].includes(name);
  const hitsAt = (x, y) => {
    raycaster.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera);
    return raycaster.intersectObject(root, true);
  };
  const data = (x, y, hit) => ({
    x: rect.x + x * rect.width,
    y: rect.y + y * rect.height,
    uv: { x: hit.uv.x * 1024, y: hit.uv.y * 1024 },
  });
  const gaps = [];
  let protectedPoint = null;
  let line = null;
  for (let y = 0.18; y < 0.65; y += 0.015) {
    let run = [];
    for (let x = 0.2; x <= 0.8; x += 0.0125) {
      const hits = hitsAt(x, y);
      const first = hits.find((h) => h.uv);
      const picked = pickPaintIntersection(hits, paintable);
      const mat =
        first &&
        (Array.isArray(first.object.material)
          ? first.object.material[first.face.materialIndex]
          : first.object.material);
      if (
        picked &&
        mat &&
        !paintable(mat.name) &&
        !isVisibleTexel(mat, first.uv) &&
        gaps.length < 8
      )
        gaps.push(data(x, y, picked));
      if (
        first &&
        mat &&
        !paintable(mat.name) &&
        isVisibleTexel(mat, first.uv) &&
        !protectedPoint
      )
        protectedPoint = data(x, y, first);
      if (
        picked &&
        (Array.isArray(picked.object.material)
          ? picked.object.material[picked.face.materialIndex]
          : picked.object.material
        ).name === "Head"
      )
        run.push(data(x, y, picked));
      else {
        if (run.length > 12 && (!line || run.length > line.length)) line = run;
        run = [];
      }
    }
    if (run.length > 12 && (!line || run.length > line.length)) line = run;
  }
  VRMUtils.deepDispose(root);
  return { gaps, protectedPoint, line };
}
