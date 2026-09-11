const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('minicat assets exist in dedicated directory', () => {
    const baseDir = path.resolve(__dirname, '../assets/minicat');
    const vrmPath = path.join(baseDir, 'PaintAnimationFaceoldbodyCat96.vrm');
    const guidePath = path.join(baseDir, 'coloring-guide.png');

    assert.ok(fs.existsSync(vrmPath), 'minicat VRM model must exist in assets/minicat');
    assert.ok(fs.existsSync(guidePath), 'minicat coloring guide must exist in assets/minicat');
});

test('minidog assets and configuration exist', async () => {
    const baseDir = path.resolve(__dirname, '../assets/minidog');
    const vrmPath = path.join(baseDir, 'base.vrm');
    const guidePath = path.join(baseDir, 'coloring-guide.png');

    assert.ok(fs.existsSync(vrmPath), 'minidog VRM model must exist in assets/minidog');
    assert.ok(fs.existsSync(guidePath), 'minidog coloring guide must exist in assets/minidog');

    const mod = await import('../src/pet-configs.js');
    assert.ok(mod.PET_CONFIGS.minidog, 'minidog must be registered in PET_CONFIGS');
    assert.equal(mod.getPetConfig('minidog').id, 'minidog');
});
