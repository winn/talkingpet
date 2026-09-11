const baseBufferCache = new Map();
let activeObjectUrls = new Set();

export async function fetchBaseVrmBuffer(url) {
  if (baseBufferCache.has(url)) return baseBufferCache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch base VRM: ${res.status}`);
  const buffer = await res.arrayBuffer();
  baseBufferCache.set(url, buffer);
  return buffer;
}

export async function patchVrmWithTexture(baseBuffer, pngBlob) {
  const dv = new DataView(baseBuffer);
  const magic = dv.getUint32(0, true);
  if (magic !== 0x46546C67) throw new Error('Invalid GLB magic header');

  const jsonChunkLen = dv.getUint32(12, true);
  const jsonBytes = new Uint8Array(baseBuffer, 20, jsonChunkLen);
  const gltf = JSON.parse(new TextDecoder().decode(jsonBytes));

  const pngBuffer = await pngBlob.arrayBuffer();
  const pngPaddedLen = Math.ceil(pngBuffer.byteLength / 4) * 4;

  const binChunkOffset = 20 + jsonChunkLen;
  const binChunkLen = dv.getUint32(binChunkOffset, true);
  const binBytes = new Uint8Array(baseBuffer, binChunkOffset + 8, binChunkLen);

  const editableMaterialNames = new Set(['body', 'Head']);
  const targetImageIndices = new Set();

  if (gltf.materials) {
    for (const mat of gltf.materials) {
      if (!editableMaterialNames.has(mat.name)) continue;
      const pbr = mat.pbrMetallicRoughness;
      let baseTexIdx = null;

      if (pbr && pbr.baseColorTexture != null) {
        baseTexIdx = pbr.baseColorTexture.index;
        if (gltf.textures && gltf.textures[baseTexIdx] != null) {
          targetImageIndices.add(gltf.textures[baseTexIdx].source);
        }
      }

      if (mat.extensions) {
        for (const [extName, ext] of Object.entries(mat.extensions)) {
          if (!ext) continue;
          if (ext.baseColorTexture != null) {
            const texIdx = ext.baseColorTexture.index;
            if (baseTexIdx === null) baseTexIdx = texIdx;
            if (gltf.textures && gltf.textures[texIdx] != null) {
              targetImageIndices.add(gltf.textures[texIdx].source);
            }
          }
          if (ext.shadeMultiplyTexture != null) {
            const texIdx = ext.shadeMultiplyTexture.index;
            if (gltf.textures && gltf.textures[texIdx] != null) {
              targetImageIndices.add(gltf.textures[texIdx].source);
            }
          }
        }

        const mtoon = mat.extensions.VRMC_materials_mtoon;
        if (mtoon && baseTexIdx !== null) {
          if (!mtoon.shadeMultiplyTexture) {
            mtoon.shadeMultiplyTexture = { index: baseTexIdx };
            if (pbr?.baseColorTexture?.extensions?.KHR_texture_transform) {
              mtoon.shadeMultiplyTexture.extensions = {
                KHR_texture_transform: JSON.parse(
                  JSON.stringify(pbr.baseColorTexture.extensions.KHR_texture_transform)
                )
              };
            }
          } else {
            mtoon.shadeMultiplyTexture.index = baseTexIdx;
          }
        }
      }
    }
  }

  if (gltf.extensions?.VRM?.materialProperties) {
    for (const mp of gltf.extensions.VRM.materialProperties) {
      if (!editableMaterialNames.has(mp.name)) continue;
      if (mp.textureProperties) {
        const mainTexIdx = mp.textureProperties._MainTex;
        if (mainTexIdx != null) {
          if (gltf.textures && gltf.textures[mainTexIdx] != null) {
            targetImageIndices.add(gltf.textures[mainTexIdx].source);
          }
          mp.textureProperties._ShadeTexture = mainTexIdx;
        }
        const shadeTexIdx = mp.textureProperties._ShadeTexture;
        if (shadeTexIdx != null && gltf.textures && gltf.textures[shadeTexIdx] != null) {
          targetImageIndices.add(gltf.textures[shadeTexIdx].source);
        }
      }
    }
  }

  if (targetImageIndices.size === 0) targetImageIndices.add(0);

  const newBvIndex = gltf.bufferViews.length;
  gltf.bufferViews.push({
    buffer: 0,
    byteOffset: binChunkLen,
    byteLength: pngBuffer.byteLength
  });
  gltf.buffers[0].byteLength += pngPaddedLen;

  for (const imgIdx of targetImageIndices) {
    if (gltf.images && gltf.images[imgIdx] != null) {
      delete gltf.images[imgIdx].uri;
      gltf.images[imgIdx].bufferView = newBvIndex;
      gltf.images[imgIdx].mimeType = 'image/png';
    }
  }

  const newJsonStr = JSON.stringify(gltf);
  const newJsonRaw = new TextEncoder().encode(newJsonStr);
  const newJsonPaddedLen = Math.ceil(newJsonRaw.byteLength / 4) * 4;
  const paddedJson = new Uint8Array(newJsonPaddedLen).fill(0x20);
  paddedJson.set(newJsonRaw);

  const paddedPng = new Uint8Array(pngPaddedLen);
  paddedPng.set(new Uint8Array(pngBuffer));

  const newBinLen = binChunkLen + pngPaddedLen;
  const totalLen = 12 + 8 + newJsonPaddedLen + 8 + newBinLen;
  const out = new ArrayBuffer(totalLen);
  const odv = new DataView(out);

  odv.setUint32(0, 0x46546C67, true);
  odv.setUint32(4, 2, true);
  odv.setUint32(8, totalLen, true);

  odv.setUint32(12, newJsonPaddedLen, true);
  odv.setUint32(16, 0x4E4F534A, true);
  new Uint8Array(out, 20, newJsonPaddedLen).set(paddedJson);

  const binStart = 20 + newJsonPaddedLen;
  odv.setUint32(binStart, newBinLen, true);
  odv.setUint32(binStart + 4, 0x004E4942, true);
  new Uint8Array(out, binStart + 8, binChunkLen).set(binBytes);
  new Uint8Array(out, binStart + 8 + binChunkLen, pngPaddedLen).set(paddedPng);

  return new Blob([out], { type: 'model/gltf-binary' });
}

export async function createPetVrmUrl(baseModelUrl, textureBlob) {
  const baseBuffer = await fetchBaseVrmBuffer(baseModelUrl);
  const patchedBlob = await patchVrmWithTexture(baseBuffer, textureBlob);
  const blobUrl = URL.createObjectURL(patchedBlob);
  activeObjectUrls.add(blobUrl);
  return blobUrl;
}

export function revokeAllPetVrmUrls() {
  for (const url of activeObjectUrls) {
    try { URL.revokeObjectURL(url); } catch (_) {}
  }
  activeObjectUrls.clear();
}
