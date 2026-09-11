import { test as base, expect } from "@playwright/test";

/**
 * Every test starts with an empty crew, the way a fresh browser used to
 * before pets followed the account. Signed-in state comes from global-setup.
 */
export const test = base.extend({
  freshCrew: [
    async ({ page }, use) => {
      await page.goto("/");
      await page.evaluate(async () => {
        const db = await import("/src/pet-db.js");
        for (const pet of await db.getAllPets()) await db.deletePetById(pet.id);
      });
      await use();
    },
    { auto: true },
  ],
});

export { expect };
