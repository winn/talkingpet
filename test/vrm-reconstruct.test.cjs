const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('vrm-reconstruct exports patching and url creation functions', async () => {
    const mod = await import('../src/vrm-reconstruct.js');
    assert.equal(typeof mod.patchVrmWithTexture, 'function');
    assert.equal(typeof mod.createPetVrmUrl, 'function');
    assert.equal(typeof mod.fetchBaseVrmBuffer, 'function');
    assert.equal(typeof mod.revokeAllPetVrmUrls, 'function');
});

test('patchVrmWithTexture produces valid GLB binary header', async () => {
    const mod = await import('../src/vrm-reconstruct.js');
    const vrmPath = path.resolve(__dirname, '../assets/minicat/PaintAnimationFaceoldbodyCat96.vrm');
    const baseBuffer = fs.readFileSync(vrmPath).buffer;

    // Create a mock 1x1 png blob
    const mockPngBuffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
    const mockBlob = new Blob([mockPngBuffer], { type: 'image/png' });

    const resultBlob = await mod.patchVrmWithTexture(baseBuffer, mockBlob);
    const resultBuffer = await resultBlob.arrayBuffer();
    const dv = new DataView(resultBuffer);
    const magic = dv.getUint32(0, true);

    assert.equal(magic, 0x46546C67, 'Magic header must match glTF (0x46546C67)');
    assert.equal(dv.getUint32(4, true), 2, 'glTF version must be 2');
    assert.ok(resultBuffer.byteLength > 3000000, 'Resulting GLB should be a complete model binary');
});

test('patchVrmWithTexture configures shadeMultiplyTexture to match baseColorTexture on editable materials', async () => {
    const mod = await import('../src/vrm-reconstruct.js');
    const vrmPath = path.resolve(__dirname, '../assets/minicat/PaintAnimationFaceoldbodyCat96.vrm');
    const baseBuffer = fs.readFileSync(vrmPath).buffer;

    const mockPngBuffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
    const mockBlob = new Blob([mockPngBuffer], { type: 'image/png' });

    const resultBlob = await mod.patchVrmWithTexture(baseBuffer, mockBlob);
    const resultBuffer = await resultBlob.arrayBuffer();
    const dv = new DataView(resultBuffer);
    const jsonLen = dv.getUint32(12, true);
    const jsonStr = new TextDecoder().decode(new Uint8Array(resultBuffer, 20, jsonLen));
    const gltf = JSON.parse(jsonStr);

    const editableMaterials = gltf.materials.filter(m => m.name === 'body' || m.name === 'Head');
    assert.ok(editableMaterials.length > 0, 'Must have editable materials');

    for (const mat of editableMaterials) {
        const baseTexIdx = mat.pbrMetallicRoughness?.baseColorTexture?.index;
        assert.notEqual(baseTexIdx, undefined, `${mat.name} must have baseColorTexture`);
        const mtoon = mat.extensions?.VRMC_materials_mtoon;
        assert.ok(mtoon, `${mat.name} must have VRMC_materials_mtoon extension`);
        assert.ok(mtoon.shadeMultiplyTexture, `${mat.name} must have shadeMultiplyTexture`);
        assert.equal(mtoon.shadeMultiplyTexture.index, baseTexIdx, `${mat.name} shadeMultiplyTexture must match baseColorTexture index`);
    }
});

