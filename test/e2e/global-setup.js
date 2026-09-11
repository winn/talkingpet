import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { loadEnv } from "vite";

export const AUTH_STATE = "test-results/e2e-auth.json";

/**
 * Signs in once through the real sign-in screen and saves the browser
 * storage so every spec starts on the pet hub already signed in.
 * Needs E2E_EMAIL and E2E_PASSWORD (an account created in the app) in .env.
 */
export default async function globalSetup(config) {
  const env = { ...loadEnv("development", process.cwd(), ""), ...process.env };
  const email = env.E2E_EMAIL;
  const password = env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "End-to-end tests need an account: set E2E_EMAIL and E2E_PASSWORD in .env (create the account in the app first).",
    );
  }
  const baseURL = config.projects[0].use.baseURL;
  mkdirSync("test-results", { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();
  try {
    await page.goto(baseURL);
    await page.locator("#loginEmail").fill(email);
    await page.locator("#loginPassword").fill(password);
    await page.locator("#loginSubmitBtn").click();
    await page.locator("#accountNav").waitFor({ state: "visible", timeout: 20000 });
    await page.context().storageState({ path: AUTH_STATE });
  } catch (err) {
    const message = await page
      .locator("#loginError")
      .textContent()
      .catch(() => "");
    throw new Error(`Could not sign in as ${email}: ${message || err.message}`);
  } finally {
    await browser.close();
  }
}
