import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const heatStats = (page: Page) => page.locator(".forecast-temperature-surface").evaluate((node) => {
  const canvas = node as HTMLCanvasElement, data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
  const alphas = new Set<number>(); let max = 0, clear = 0;
  for (let i = 3; i < data.length; i += 4) { alphas.add(data[i]!); max = Math.max(max, data[i]!); if (!data[i]) clear++; }
  return { max, shades: alphas.size, clear };
});

async function openMap(page: Page) {
  await page.addInitScript(() => localStorage.setItem("greenspark.demoUser", "staff-manager"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Support before the heat" })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".support-marker").first()).toBeVisible();
}

test("filled area markers conserve customer counts and filters remain separate from the weather layer", async ({ page }) => {
  await openMap(page);
  const markerCount = async () => page.locator(".support-marker > span").evaluateAll((nodes) => nodes.reduce((sum, node) => sum + Number(node.textContent?.replaceAll(",", "")), 0));
  const groupCount = async () => Number((await page.locator(".support-member-count strong").innerText()).replaceAll(",", ""));
  expect(await markerCount()).toBe(await groupCount());
  const fills = await page.locator(".support-marker > span").evaluateAll((nodes) => nodes.map((node) => ({ color: getComputedStyle(node, "::before").backgroundColor, opacity: Number(getComputedStyle(node, "::before").opacity) })));
  expect(fills.every((fill) => fill.color !== "rgb(255, 255, 255)" && fill.opacity > 0 && fill.opacity < 1)).toBe(true);
  await expect(page.locator(".forecast-temperature-surface")).toBeAttached();
  const before = await heatStats(page);
  expect(before.shades).toBeGreaterThan(50);
  expect(before.clear).toBeGreaterThan(100); // the ocean remains clear
  // Base tiles load independently of our API; allow them to settle for the visual artifact.
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".leaflet-tile")].every((tile) => tile.complete && tile.naturalWidth > 0), undefined, { timeout: 15_000 }).catch(() => undefined);
  await page.screenshot({ path: test.info().outputPath("support-map-desktop.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("group", { name: "Primary support group", exact: true }).getByRole("button", { name: /^B Keep power connected/ }).click();
  await expect(page.getByRole("group", { name: "Primary support group", exact: true }).getByRole("button", { name: /^A Health/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Primary support group", exact: true }).getByRole("button", { name: /^B Keep power/ })).toHaveAttribute("aria-pressed", "true");
  expect(await markerCount()).toBe(await groupCount());
  await expect(page.locator('.support-marker[data-group="health"]').first()).toBeAttached();
  await expect(page.locator('.support-marker[data-group="supply"]').first()).toBeAttached();
  const hues = await page.locator(".support-filter:not(.support-filter-all)").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).getPropertyValue("--group-strong").trim()));
  expect(new Set(hues).size).toBe(6);
  await page.screenshot({ path: test.info().outputPath("support-map-overlap.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("group", { name: "Primary support group", exact: true }).getByRole("button", { name: /^C Payment support/ }).click();
  await expect(page.getByRole("group", { name: "Primary support group", exact: true }).getByRole("button", { name: /^C Payment support/ })).toHaveAttribute("aria-pressed", "true");
  expect(await markerCount()).toBe(await groupCount());
  expect(await heatStats(page)).toEqual(before);
  await page.getByRole("group", { name: "Primary support group", exact: true }).getByRole("button", { name: /^All groups/ }).click();
  expect(await markerCount()).toBe(await groupCount());
});

test("six solution cards stack, share exact solutions once and retain postcode scope when toggling groups", async ({ page }) => {
  await openMap(page);
  await page.getByRole("group", { name: "Primary support group", exact: true }).getByRole("button", { name: /^All groups/ }).click();
  await expect(page.locator(".support-solution-card")).toHaveCount(6);
  await expect(page.locator('.support-solution-card[data-group="monitor"] button')).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('.support-solution-card[data-group="health"] button')).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('.shared-solution-entry[data-solution-id="hardship"]')).toHaveCount(1);
  await page.locator(".shared-solutions summary").click();
  await expect(page.locator('.shared-solution-entry[data-solution-id="hardship"]')).toBeVisible();
  await page.locator(".shared-solutions summary").click();
  await page.locator(".support-area-picker summary").click();
  await page.locator(".support-area-picker button").filter({ hasText: "Mandurah" }).click();
  await expect(page.locator(".support-detail-title")).toContainText("postcode 6210");
  await page.getByRole("group", { name: "Primary support group", exact: true }).getByRole("button", { name: /^E Energy coaching/ }).click();
  await expect(page.locator(".support-solution-card")).toHaveCount(5);
  await expect(page.locator(".support-detail-title")).toContainText("postcode 6210");
  await page.getByRole("group", { name: "Primary support group", exact: true }).getByRole("button", { name: /^E Energy coaching/ }).click();
  await expect(page.locator('.support-solution-card[data-group="coaching"] button')).toHaveAttribute("aria-expanded", "true");
  const counts = await page.locator(".solution-card-heading small").allTextContents();
  const sum = counts.reduce((n, value) => n + Number(value.split(" customers")[0]!.replaceAll(",", "")), 0);
  expect(sum).toBe(Number((await page.locator(".support-member-count strong").innerText()).replaceAll(",", "")));
  await page.getByRole("button", { name: "Show the whole region" }).click();
  await expect(page.locator(".support-detail-title")).toContainText("Perth & Peel");
  await page.locator(".support-area-picker summary").click();
  await page.locator('.support-solution-card[data-group="supply"] button').click();
  await page.getByRole("button", { name: "Reset map", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".leaflet-tile")].every((tile) => tile.complete && tile.naturalWidth > 0), undefined, { timeout: 15_000 }).catch(() => undefined);
  await page.screenshot({ path: test.info().outputPath("six-group-solutions.png"), fullPage: true, animations: "disabled" });
});

test("area review drills down to its customers and preserves real case links", async ({ page }) => {
  await openMap(page);
  await page.locator(".support-area-picker summary").click();
  await page.locator(".support-area-picker button").filter({ hasText: "Mandurah" }).click();
  await expect(page.locator(".support-detail-title")).toContainText("postcode 6210");
  await expect(page.locator('.support-marker[aria-pressed="true"]')).toHaveCount(1);
  const count = Number(await page.locator(".support-member-count strong").innerText());
  await page.getByRole("button", { name: "Review this area" }).click();
  await expect(page.locator("#group-customers")).toHaveAttribute("open", "");
  await expect(page.locator(".support-customer-table tbody tr")).toHaveCount(Math.min(50, count));
  await page.locator(".support-customer-table .name-link").first().click();
  await expect(page).toHaveURL(/\/accounts\/DEMO-/);
});

test("a later cool day visibly cools the temperature layer and attention without removing the group", async ({ page }) => {
  await openMap(page);
  const count = await page.locator(".support-member-count strong").innerText();
  const hot = await heatStats(page);
  await page.getByRole("group", { name: "Forecast period", exact: true }).getByRole("button").last().click();
  await expect(page.locator(".support-member-count strong")).toHaveText(count);
  await expect(page.locator(".support-attention")).toContainText("Monitor and check recorded needs");
  await expect.poll(async () => (await heatStats(page)).max).toBeLessThan(hot.max / 2);
  await expect(page.locator(".support-map-caption")).toContainText("Daily maximum");
});

test("mobile controls fit the viewport and action filters work from the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page);
  const filter = page.getByRole("group", { name: "Primary support group", exact: true }).getByRole("button", { name: /^B Keep power connected/ });
  await filter.focus();
  await page.keyboard.press("Enter");
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".leaflet-tile")].every((tile) => tile.complete && tile.naturalWidth > 0), undefined, { timeout: 15_000 }).catch(() => undefined);
  await page.screenshot({ path: test.info().outputPath("support-map-mobile.png"), fullPage: true, animations: "disabled" });
  await page.getByLabel("Map area", { exact: true }).selectOption("wa");
  await expect(page.locator(".support-detail-title")).toContainText("All of WA");
  await expect(page.getByText("Regional totals · select a circle to zoom in")).toBeVisible();
  const regional = page.locator(".support-marker.is-regional").first();
  await expect(regional).toBeVisible();
  const markerTotal = await page.locator(".support-marker").count();
  await regional.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.locator(".support-marker").count()).toBeGreaterThan(markerTotal);
});

test("actions create a persistent area task, exclude duplicates and track customer progress", async ({ page }) => {
  await openMap(page);
  await page.locator(".support-area-picker summary").click();
  await page.locator(".support-area-picker button").filter({ hasText: "Mandurah" }).click();
  await page.locator(".support-area-picker summary").click();
  await page.getByRole("tab", { name: "Actions", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "Actions", exact: true });
  await expect(panel.locator(".group-task-form")).toBeVisible();
  await panel.getByRole("combobox", { name: "Assign to", exact: true }).selectOption({ index: 1 });
  await expect(panel.locator(".task-selection-info strong")).toHaveText(/\d+ new customers/);
  const expected = Number((await panel.locator(".task-selection-info strong").innerText()).split(" ")[0]);
  expect(expected).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath("group-actions-create.png"), fullPage: true, animations: "disabled" });
  await panel.getByRole("button", { name: /^Create group task/ }).click();
  await expect(panel.getByRole("status")).toContainText(`Task created for ${expected} customers`);
  await expect(panel.locator(".saved-group-task")).toHaveCount(1);
  await expect(panel.locator(".task-selection-info")).toContainText(`${expected} already assigned`);
  await expect(panel.getByRole("button", { name: /^Create group task/ })).toBeDisabled();
  await panel.getByRole("button", { name: "View task", exact: true }).click();
  for (let completed = 1; completed <= Math.min(3, expected); completed++) {
    await panel.locator('.task-member-list input:not(:checked)').first().click();
    await expect(panel.locator(".task-progress-label")).toHaveText(`${completed} of ${expected} completed`);
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "Support before the heat" })).toBeVisible();
  await page.getByRole("tab", { name: "Actions", exact: true }).click();
  await panel.getByRole("button", { name: "View task", exact: true }).click();
  await expect(panel.locator(".task-progress-label")).toHaveText(`${Math.min(3, expected)} of ${expected} completed`);
  await expect(panel.locator(".task-detail-card")).toContainText("postcode 6210");
  await expect(panel.getByRole("link", { name: /^Open case for/ }).first()).toHaveAttribute("href", /\/accounts\/DEMO-/);
  await page.screenshot({ path: test.info().outputPath("group-actions-progress.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("tab", { name: "Solutions", exact: true }).click();
  await expect(page.locator(".support-solution-stack").first()).toBeVisible();
  await page.getByRole("tab", { name: "Solutions", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Actions", exact: true })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Actions", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.locator(".group-task-form")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("group-actions-mobile.png"), fullPage: true, animations: "disabled" });
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const failures = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: { run: () => Promise<{ violations: { id: string; impact: string; nodes: unknown[] }[] }> } }).axe.run();
    return result.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
  });
  expect(failures).toEqual([]);
});

test("group controls and map have no serious accessibility violations", async ({ page }) => {
  await openMap(page);
  await page.getByRole("group", { name: "Primary support group", exact: true }).getByRole("button", { name: /^All groups/ }).click();
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const failures = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: { run: () => Promise<{ violations: { id: string; impact: string; description: string; nodes: { target: string[]; failureSummary: string }[] }[] }> } }).axe.run();
    return result.violations.filter((item) => item.impact === "serious" || item.impact === "critical").map((item) => ({ id: item.id, description: item.description, nodes: item.nodes }));
  });
  expect(failures).toEqual([]);
});

test("week overview follows region and groups while emergency warnings remain current across forecast dates", async ({ page }) => {
  await page.route("**/api/emergency", (route) => route.fulfill({ json: { available: true, fetchedAt: "2026-10-26T02:30:00Z", error: null,
    alerts: ["Emergency Warning", "Watch and Act", "Advice"].map((level, i) => ({ id: `test-${i}`, headline: `TEST ONLY ${level}`, event: "Test warning", category: "Test", alertLevel: level, severity: "Test", sent: null, areaDesc: "Browser test area", web: null, polygons: [], centre: [-31.8 - i * .1, 116.1] })) } }));
  await openMap(page);
  const week = page.getByRole("region", { name: "The week ahead", exact: true });
  await expect(week.locator(".support-day")).toHaveCount(7);
  expect((await week.locator(".support-day-town").allTextContents()).every((name) => !name.includes("Kununurra"))).toBe(true);
  const first = week.locator(".support-day").first();
  const firstDate = await first.getAttribute("data-date");
  const act = Number(await first.locator(".support-day-counts b").first().innerText());
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".support-map-caption")).toContainText(firstDate!);
  if (act) await expect(page.locator(".support-attention strong")).toHaveText(`${act} need urgent review`);
  await expect(page.locator(".alert-tri")).toHaveCount(3);
  await page.locator('.alert-tri[title="TEST ONLY Advice"]').click();
  await expect(page.locator(".leaflet-popup-content")).toContainText("TEST ONLY Advice");
  await page.locator(".leaflet-popup-close-button").click();
  await week.locator(".support-day").last().click();
  await expect(page.locator(".alert-tri")).toHaveCount(3);
  await expect(page.getByLabel("Weather and emergency legend")).toContainText("current warnings");
  await page.getByRole("checkbox", { name: /^Emergency WA/ }).uncheck();
  await expect(page.locator(".alert-tri")).toHaveCount(0);
  await expect(page.getByLabel("Weather and emergency legend")).toContainText("Layer off");
  await page.getByRole("group", { name: "Primary support group", exact: true }).getByRole("button", { name: /^All groups/ }).click();
  expect(Number(await first.locator(".support-day-counts b").first().innerText())).toBeGreaterThanOrEqual(act);
  await page.getByLabel("Map area", { exact: true }).selectOption("wa");
  expect((await week.locator(".support-day-town").allTextContents()).some((name) => name.includes("Kununurra"))).toBe(true);
  await week.getByRole("button", { name: "Whole week", exact: true }).click();
  await expect(page.locator(".support-map-caption")).toContainText("Peak daily maximum");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
