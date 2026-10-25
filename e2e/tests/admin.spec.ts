import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { api } from "./helpers";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const FILE = resolve(import.meta.dirname, "..", ".runtime", "flow.json");
const onDisk = () => JSON.parse(readFileSync(FILE, "utf8"));

async function openAdmin(page: Page, user = "staff-manager") {
  await page.addInitScript((u) => localStorage.setItem("greenspark.demoUser", u), user);
  await page.goto("/flowchart");
  await expect(page.getByTestId("count-signals")).toHaveText(/\d+/);
}
const details = (page: Page) => page.getByRole("complementary", { name: "Details" });
const saved = (page: Page) => expect(page.getByRole("status").filter({ hasText: "saved to the file" })).toBeVisible();

test.describe.configure({ mode: "serial" });

test("Flowchart and Data sources are in the BTS menu", async ({ page }) => {
  await page.addInitScript((u) => localStorage.setItem("greenspark.demoUser", u), "staff-manager");
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Weather outlook" })).toHaveAttribute("aria-current", "page"); // the home page
  await expect(nav.getByRole("link", { name: "Case queue" })).toHaveAttribute("href", "/queue");
  await nav.getByRole("button", { name: /BTS/ }).click();
  await nav.getByRole("link", { name: "Flowchart" }).click();
  await expect(page).toHaveURL(/\/bts\/flowchart$/);
  await expect(page.getByRole("heading", { name: "Utility hardship flow" })).toBeVisible();
  await expect(page.getByTestId("count-signals")).toHaveText("111");
  await expect(page.getByTestId("count-circumstances")).toHaveText("99");
  await expect(page.getByTestId("count-solutions")).toHaveText("49");
  await nav.getByRole("button", { name: /BTS/ }).click();
  await nav.getByRole("link", { name: "Data sources" }).click();
  await expect(page).toHaveURL(/\/bts\/data-sources$/);
  await expect(page.getByRole("heading", { name: "Data sources", level: 1 })).toBeVisible();
  await expect(page.locator("section[aria-labelledby=\"ds-files\"] .ds-table tbody tr")).toHaveCount(22);
  await page.getByRole("link", { name: /ERVEI casework/ }).click();
  await expect(page.locator(".case-table")).toBeVisible();
});

test("selecting a circumstance traces its signals and solutions", async ({ page }) => {
  await openAdmin(page);
  await page.getByTestId("node-circumstance-job_loss").click();
  await expect(page.getByRole("heading", { name: "Job loss, redundancy or stood down" })).toBeVisible();
  await expect(page.locator(".fboard.focus")).toBeVisible();
  await expect(page.getByTestId("node-signal-ask_lost_job")).toHaveClass(/\bon\b/);
  await expect(page.getByTestId("node-solution-payment_extension")).toHaveClass(/\bon\b/);
});

test("search finds an item and the utility filter narrows the board", async ({ page }) => {
  await openAdmin(page);
  await page.getByLabel("Find a signal, circumstance or solution").fill("lost job");
  await page.getByRole("list", { name: "Search results" }).getByRole("button").first().click();
  await expect(page.getByRole("heading", { name: "Says: lost job" })).toBeVisible();
  await details(page).getByRole("button", { name: "Close details" }).click();
  const before = Number(await page.getByTestId("count-circumstances").innerText());
  await page.locator(`label[for="u-water"]`).click();
  expect(Number(await page.getByTestId("count-circumstances").innerText())).toBeLessThan(before);
});

test("renaming an item is saved to the JSON file and survives a reload", async ({ page }) => {
  await openAdmin(page);
  await page.getByTestId("node-signal-ask_lost_job").click();
  await details(page).getByRole("button", { name: "Edit", exact: true }).click();
  await details(page).getByLabel("Name", { exact: true }).fill("Recently lost job");
  await details(page).getByRole("button", { name: "Save changes" }).click();
  await saved(page);
  expect(onDisk().signals.find((s: { id: string }) => s.id === "ask_lost_job").name).toBe("Recently lost job");
  await page.reload();
  await expect(page.getByTestId("node-signal-ask_lost_job")).toContainText("Recently lost job");
});

test("links can be changed from either end and stay consistent in the file", async ({ page }) => {
  await openAdmin(page);
  await page.getByTestId("node-signal-ask_lost_job").click();
  const section = details(page).getByRole("region", { name: /circumstances/i }).first();
  await section.getByLabel("Strength of the link with Job loss, redundancy or stood down").selectOption("supporting");
  await saved(page);
  let d = onDisk();
  const sig = d.signals.find((s: { id: string }) => s.id === "ask_lost_job");
  const circ = d.circumstances.find((c: { id: string }) => c.id === "job_loss");
  expect(circ.signals.find((l: { id: string }) => l.id === "ask_lost_job").strength).toBe("supporting");
  expect(sig.points_to.find((l: { id: string }) => l.id === "job_loss").strength).toBe("supporting");
  await section.getByRole("button", { name: "Remove link to Job loss, redundancy or stood down" }).click();
  await saved(page);
  d = onDisk();
  expect(d.circumstances.find((c: { id: string }) => c.id === "job_loss").signals.some((l: { id: string }) => l.id === "ask_lost_job")).toBe(false);
  expect(d.meta.counts.links).toBe(520);
  await page.getByRole("button", { name: /^Undo/ }).click();
  await saved(page);
  expect(onDisk().meta.counts.links).toBe(521);
});

test("add a signal, then delete it and undo", async ({ page }) => {
  await openAdmin(page);
  await page.getByRole("button", { name: "Add a signal" }).click();
  await details(page).getByLabel("Name", { exact: true }).fill("Test signal from browser");
  await details(page).getByRole("button", { name: "Add", exact: true }).click();
  await saved(page);
  expect(onDisk().signals.some((s: { name: string }) => s.name === "Test signal from browser")).toBe(true);
  await expect(page.getByTestId("count-signals")).toHaveText("112");
  await details(page).getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await saved(page);
  await expect(page.getByTestId("count-signals")).toHaveText("111");
  await page.getByRole("button", { name: /^Undo/ }).click();
  await expect(page.getByTestId("count-signals")).toHaveText("112");
  await saved(page);
  expect(onDisk().meta.counts.signals).toBe(112);
});

test("settings dialog opens with categories and circumstance types", async ({ page }) => {
  await openAdmin(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg.getByText("Categories")).toBeVisible();
  await expect(dlg.getByText("Circumstance types")).toBeVisible();
});

test("any demo user (a support worker) can edit", async ({ page }) => {
  await openAdmin(page, "staff-maya");
  await expect(page.getByRole("button", { name: "Add a signal" })).toBeEnabled();
  const res = await api(page, "staff-maya", "GET", "/api/admin/flow");
  expect(res.status).toBe(200);
});

test("Flowchart page has no accessibility violations", async ({ page }) => {
  await openAdmin(page);
  await page.getByTestId("node-circumstance-job_loss").click();
  await page.addScriptTag({ content: readFileSync(axePath, "utf8") });
  const bad = await page.evaluate(async () => {
    // @ts-expect-error axe is injected above
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] });
    return r.violations.filter((v: { impact: string }) => v.impact === "serious" || v.impact === "critical")
      .map((v: { id: string; nodes: { target: unknown }[] }) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => JSON.stringify(n.target)).join(", ")}`);
  });
  expect(bad).toEqual([]);
});

test("small screens: no sideways page scroll; details open as a bottom sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openAdmin(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByTestId("node-circumstance-job_loss").click();
  await expect(page.getByRole("heading", { name: "Job loss, redundancy or stood down" })).toBeInViewport();
});
