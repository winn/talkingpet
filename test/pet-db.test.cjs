const test = require('node:test');
const assert = require('node:assert/strict');

test('pet database CRUD interface contract validation', async () => {
    const petDb = await import('../src/pet-db.js');
    assert.equal(typeof petDb.getAllPets, 'function');
    assert.equal(typeof petDb.getPetById, 'function');
    assert.equal(typeof petDb.savePet, 'function');
    assert.equal(typeof petDb.deletePetById, 'function');
    assert.equal(typeof petDb.openPetDb, 'function');
    assert.equal(typeof petDb.getDeviceId, 'function');
});

test('pet database rejects clearly when Supabase is not configured', async () => {
    const petDb = await import('../src/pet-db.js');
    await assert.rejects(petDb.getAllPets(), /Supabase is not configured/);
    await assert.rejects(petDb.savePet({ id: 'x' }), /Supabase is not configured/);
    assert.equal(await petDb.getPetById(''), null);
    assert.equal(await petDb.deletePetById(''), false);
});
