// Capture every screen (incl. interactive sub-states) to docs/screenshots/.
// Usage: npx tsx scripts/screenshots.ts  (dev server + db must be running)
import "dotenv/config";
import { mkdirSync } from "node:fs";
import puppeteer, { type Page } from "puppeteer-core";
import { prisma } from "../lib/db";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const OUT = "docs/screenshots";
const BROWSER =
  process.env.BROWSER_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function shot(page: Page, name: string) {
  await new Promise((r) => setTimeout(r, 400)); // let fonts/animations settle
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("✓", name);
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const engineer = await prisma.engineer.findFirstOrThrow();
  const active = await prisma.plan.findFirst({ where: { status: "ACTIVE" } });
  const pending = await prisma.plan.findFirst({ where: { status: "PENDING" } });

  const browser = await puppeteer.launch({
    executablePath: BROWSER,
    headless: true,
    args: ["--no-first-run", "--no-default-browser-check", `--user-data-dir=${process.env.TEMP}\\tradeshura-shots`],
    defaultViewport: { width: 390, height: 844 }, // iPhone-ish
  });
  const page = await browser.newPage();

  // Sign-in page (logged out), then authenticate via the dev magic link.
  await page.goto(`${BASE}/signin`, { waitUntil: "networkidle0" });
  await shot(page, "01-signin");
  const devLink = await page.evaluate(async (email) => {
    const r = await fetch("/api/auth/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return (await r.json()).devLink as string;
  }, engineer.email);
  await page.goto(devLink, { waitUntil: "networkidle0" });

  const simple: [string, string][] = [
    ["/", "02-dashboard"],
    ["/onboarding", "03-onboarding"],
    ["/plans", "04-plans"],
    ["/doorstep", "06-doorstep"],
    ["/customers", "09-customers"],
    ["/jobs", "10-jobs"],
    ["/messages", "11-messages"],
    ["/payouts", "12-payouts"],
    ["/more", "13-more"],
    ["/campaigns", "14-campaigns-stub"],
  ];
  for (const [path, name] of simple) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
    await shot(page, name);
  }

  // Tier editor + BLOCKED state
  const plus = await prisma.planTier.findFirstOrThrow({ where: { name: "Plus" } });
  await page.goto(`${BASE}/plans/${plus.id}`, { waitUntil: "networkidle0" });
  await shot(page, "05a-tier-editor");
  await page.type('input[placeholder*="Add your own line"]', "We fix any breakdown free");
  const addBtn = await page.$$eval("button", (btns) => {
    const b = btns.find((x) => x.textContent?.trim() === "Add");
    b?.click();
    return Boolean(b);
  });
  if (addBtn) {
    await page.waitForFunction(() => document.body.textContent?.includes("BLOCKED"));
    await shot(page, "05b-tier-editor-blocked");
  }

  // Doorstep live + QR (pending plan), celebration (active plan)
  if (pending) {
    await page.goto(`${BASE}/doorstep/${pending.id}`, { waitUntil: "networkidle0" });
    await page.$$eval("button", (btns) =>
      btns.find((x) => x.textContent?.includes("Show QR"))?.click(),
    );
    await page.waitForSelector('img[alt="Signup QR code"]');
    await shot(page, "07-doorstep-live-qr");
    await page.goto(`${BASE}/p/${engineer.slug}/signup/${pending.signupToken}`, {
      waitUntil: "networkidle0",
    });
    await shot(page, "15-signup-tiers");
  }
  if (active) {
    await page.goto(`${BASE}/doorstep/${active.id}`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.textContent?.includes("Flame lit"));
    await shot(page, "08-doorstep-celebration");
    await page.goto(`${BASE}/p/${engineer.slug}/signup/${active.signupToken}/confirmed`, {
      waitUntil: "networkidle0",
    });
    await shot(page, "16-signup-confirmed");
    await page.goto(`${BASE}/portal/${active.portalToken}`, { waitUntil: "networkidle0" });
    await shot(page, "17-portal");
    await page.goto(`${BASE}/portal/${active.portalToken}/report`, { waitUntil: "networkidle0" });
    await shot(page, "18a-portal-report");
    await page.type("textarea", "I can smell gas in the kitchen");
    await page.$$eval("button", (btns) =>
      btns.find((x) => x.textContent?.includes("Send report"))?.click(),
    );
    await page.waitForFunction(() => document.body.textContent?.includes("act now"));
    await shot(page, "18b-emergency-stop");
    await page.goto(`${BASE}/portal/${active.portalToken}/manage`, { waitUntil: "networkidle0" });
    await shot(page, "19a-manage");
    await page.$$eval("button", (btns) =>
      btns.find((x) => x.textContent?.trim() === "Cancel my plan")?.click(),
    );
    await page.waitForFunction(() => document.body.textContent?.includes("Yes, cancel my plan"));
    await shot(page, "19b-manage-confirm"); // deliberately not tapping "Yes"
  }

  await browser.close();
  console.log(`\nSaved to ${OUT}/`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
