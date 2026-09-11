const test = require('node:test');
const assert = require('node:assert/strict');

test('preview-360 calculates correct angles for 18 steps', async () => {
    const mod = await import('../src/preview-360.js');
    const angles = mod.calculateRotationAngles(18);
    assert.equal(angles.length, 18);
    assert.equal(angles[0], 0);
    assert.equal(angles[1], 20);
    assert.equal(angles[17], 340);
});

test('preview-360 exports capture and mount rotator functions', async () => {
    const mod = await import('../src/preview-360.js');
    assert.equal(typeof mod.capture360Frames, 'function');
    assert.equal(typeof mod.mount360Rotator, 'function');
});
