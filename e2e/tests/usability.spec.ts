import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { expectTotal, openQueue } from "./helpers";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

async function seriousViolations(page: Page) {
  await page.addScriptTag({ content: readFileSync(axePath, "utf8") });
  const result = await page.evaluate(async () => {
    // @ts-expect-error axe is injected above
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] });
    return r.violations.filter((v: { impact: string }) => v.impact === "serious" || v.impact === "critical")
      .map((v: { id: string; nodes: { target: unknown }[] }) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => JSON.stringify(n.target)).join(", ")}`);
  });
  return result as string[];
}

test.describe("states and content rules", () => {
  test("empty results, priority from signals, and unknown evidence", async ({ page }) => {
    await openQueue(page);
    await page.getByPlaceholder("Search name, account number or suburb…").fill("zzzz-no-match");
    await expect(page.getByRole("heading", { name: "No cases match" })).toBeVisible();
    await page.getByRole("button", { name: "Reset filters" }).click();
    await expectTotal(page, 200);

    // With the flowchart in use every seeded case has a priority worked out from its signals, so none are pending.
    await page.locator(".sidebar").getByLabel("Assessment availability").selectOption("pending");
    await expect(page.getByRole("heading", { name: "No cases match" })).toBeVisible();
    await page.getByRole("button", { name: "Reset", exact: true }).click();

    // A minimum score of 1 leaves out the cases with nothing flagged (score 0).
    await page.locator(".sidebar input[type=range]").fill("1");
    await expectTotal(page, 165);
    await page.getByRole("button", { name: "Reset", exact: true }).click();

    // The highest-priority case explains why it is flagged, with staff-review suggestions.
    await page.locator("tbody tr").first().locator(".name-link").click();
    const panel = page.locator(".case-page");
    await expect(panel.getByRole("heading", { name: "What's going on" })).toBeVisible(); // the at-a-glance summary comes first
    // Each detailed section opens in a modal from the tiles under the summary.
    const modal = page.locator("dialog.case-modal");
    const section = async (name: string) => {
      await panel.locator(".more-tiles").getByRole("link", { name: new RegExp(`^${name}`) }).click();
      await expect(modal).toBeVisible();
    };
    const close = async () => {
      await modal.getByRole("button", { name: "Close" }).click();
      await expect(modal).toHaveCount(0);
    };
    await section("Customer and account");
    await expect(modal.getByRole("heading", { name: /Customer details/ })).toBeVisible();
    for (const label of ["Preferred name", "Gender", "Address", "Mobile", "Phone", "Email"]) await expect(modal.locator("dt", { hasText: new RegExp(`^${label}$`) })).toBeVisible();
    await expect(modal.locator("address")).toContainText(/\b\d{4}\b/); // the postcode is shown
    await expect(modal).toContainText(/@example\.com|Not recorded/);
    await close();
    await section("Support areas and why");
    await expect(modal).toContainText("Solutions for staff review");
    const suggestions = modal.locator(".suggest").first();
    expect(await suggestions.locator("ul > li").count()).toBeGreaterThan(1); // a bulleted list, one suggestion per bullet
    expect(await suggestions.evaluate((el) => !!el.firstElementChild?.matches(".sim") && el.lastElementChild?.tagName === "UL")).toBe(true); // badge first, then the list
    await expect(modal).toContainText("Assistance already reported");
    await close();
    await section("Priority");
    await expect(modal.locator("#ov-model")).toContainText("Priority from signals"); // worked out from the case's signals
    await close();
    await expect(panel).not.toContainText(/full profile/i); // there is no separate profile page, so nothing mentions one
    await page.getByRole("link", { name: /Back to case queue/ }).click();
    await expect(page.locator(".case-table")).toBeVisible();

    // A case with an unknown answer shows Unknown, never No.
    await page.getByRole("combobox", { name: "Sort cases" }).selectOption("name");
    let found = false;
    for (let i = 0; i < 8 && !found; i++) {
      await page.locator("tbody tr").nth(i).locator(".name-link").click();
      await expect(panel).toBeVisible();
      await section("Support areas and why");
      found = (await modal.locator(".answer-unknown").count()) > 0;
      if (!found) {
        await close();
        await page.getByRole("link", { name: /Back to case queue/ }).click();
        await expect(page.locator(".case-table")).toBeVisible();
      }
    }
    expect(found).toBe(true);
    await expect(modal.locator(".answer-unknown").first()).toContainText(/Unknown|Not asked/);
  });

  test("a failed list request shows an error with retry", async ({ page }) => {
    await page.route("**/api/cases?*", (route) => route.abort());
    await page.addInitScript(() => localStorage.setItem("greenspark.demoUser", "staff-manager"));
    await page.goto("/queue");
    await expect(page.getByRole("heading", { name: "We couldn’t load cases" })).toBeVisible();
    await page.unroute("**/api/cases?*");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator(".case-table")).toBeVisible();
  });
});

test.describe("case pages", () => {
  test("each case has its own address; Back returns to the same queue view; unknown cases are explained", async ({ page }) => {
    await openQueue(page);
    await page.getByRole("combobox", { name: "Sort cases" }).selectOption("name");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Page 2 of 4")).toBeVisible();
    const row = page.locator("tbody tr").nth(1);
    const id = (await row.locator(".name-link").getAttribute("data-account-link"))!; // the account number is the main ID
    await row.locator(".name-link").click();
    await expect(page).toHaveURL(new RegExp(`/accounts/${id}$`));
    await expect(page.locator(".case-page")).toContainText(id);
    await expect(page.locator(".case-page")).not.toContainText(/GS-\d{4}/); // internal case IDs are never shown
    await expect(page.locator("#queue")).not.toContainText("Support areas Filters"); // no sidebar on a case page
    await expect(page.locator("#sidebar")).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/queue$/);
    await expect(page.getByText("Page 2 of 4")).toBeVisible(); // same page of results
    await expect(page.getByRole("combobox", { name: "Sort cases" })).toHaveValue("name"); // and the same sort
    await page.goForward();
    await expect(page.locator(".case-page")).toBeVisible();

    // The address works directly (a bookmark or a shared link) and for unknown cases.
    await page.goto(`/accounts/${id}`);
    await expect(page.locator("#case-title")).toBeVisible();
    await expect(page.locator(".case-page")).toContainText(id);
    await page.goto("/accounts/DEMO-999999");
    await expect(page.getByRole("heading", { name: "Case not found" })).toBeVisible();
    await page.getByRole("link", { name: /Back to case queue/ }).click();
    await expect(page.locator(".case-table")).toBeVisible();
  });

  test("the GreenSpark logo and name lead to the weather outlook", async ({ page }) => {
    await openQueue(page);
    const brand = page.getByRole("link", { name: /ERVEI casework/ });
    await expect(brand.locator("strong")).toHaveText("ERVEI"); // ERVEI is the main name, with "Community support workspace" beneath it
    await expect(brand).toContainText("Community support workspace");
    await expect(page).toHaveTitle(/ERVEI/);
    await expect(brand).toHaveAttribute("href", "/");
    const id = (await page.locator("tbody tr").first().locator(".name-link").getAttribute("data-account-link"))!;
    await page.locator("tbody tr").first().locator(".name-link").click();
    await expect(page).toHaveURL(new RegExp(`/accounts/${id}$`));
    await brand.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Who this week’s weather could hurt" })).toBeVisible();
    await expect(page.locator(".case-page")).toHaveCount(0);
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /WIP/ }).click();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Case queue" }).click();
    await expect(page).toHaveURL(/\/queue$/);
    await expect(page.locator(".case-table")).toBeVisible();
    await brand.focus(); // keyboard users can use it too
    await page.keyboard.press("Enter");
    await expect(page.locator(".outlook")).toBeVisible();
  });

  test("a modified click leaves the browser to open the case in a new tab", async ({ page, context }) => {
    await openQueue(page);
    const link = page.locator("tbody tr").first().locator(".name-link");
    const href = await link.getAttribute("href");
    const [popup] = await Promise.all([context.waitForEvent("page"), link.click({ modifiers: ["Control"] })]);
    await popup.waitForURL(/\/accounts\/DEMO-\d+$/);
    expect(new URL(popup.url()).pathname).toBe(href);
    await expect(popup.locator(".case-page")).toBeVisible();
    await expect(page.locator(".case-table")).toBeVisible(); // this tab stayed on the queue
  });
});

test.describe("keyboard and accessibility", () => {
  test("a case page can be opened and left from the keyboard, restoring focus", async ({ page }) => {
    await openQueue(page);
    const nameLink = page.locator("tbody tr").first().locator(".name-link");
    await nameLink.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".case-page")).toBeVisible();
    await expect(page).toHaveURL(/\/accounts\/DEMO-\d+$/);
    await expect(page.locator("#case-title")).toBeFocused(); // a new page starts at its heading
    const back = page.getByRole("link", { name: /Back to case queue/ });
    await back.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".case-page")).toHaveCount(0);
    await expect(nameLink).toBeFocused();
  });

  test("filters work with the keyboard", async ({ page }) => {
    await openQueue(page);
    const toggle = page.getByRole("button", { name: /^(Expand|Collapse) Payments/ }); // its name flips when toggled
    await expect(page.getByRole("checkbox", { name: /^Prepayment self-disconnection/ })).toHaveCount(0); // areas start collapsed
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const box = page.getByRole("checkbox", { name: /^Prepayment self-disconnection/ });
    await box.focus();
    await page.keyboard.press("Space");
    await expect(page.locator(".chip")).toContainText("Prepayment self-disconnection");
    await expect(page.getByRole("checkbox", { name: /^Payments/ })).toHaveJSProperty("indeterminate", true);
  });

  test("queue and case page have no serious or critical WCAG A/AA violations", async ({ page }) => {
    await openQueue(page);
    expect(await seriousViolations(page)).toEqual([]);
    await page.locator("tbody tr").first().locator(".name-link").click();
    await expect(page.locator(".case-page")).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});

test.describe("small screen", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("no page-level horizontal scrolling; filters behind a button; the case page is usable", async ({ page }) => {
    await openQueue(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator("#sidebar")).toBeHidden();
    await page.getByRole("button", { name: /^Filters/ }).click();
    await expect(page.locator("#sidebar")).toBeVisible();
    await page.getByRole("button", { name: "Expand Payments" }).click();
    await page.getByRole("checkbox", { name: /^Prepayment self-disconnection/ }).check();
    await expectTotal(page, 20);
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.locator("tbody tr").first().locator(".name-link").click();
    const panel = page.locator(".case-page");
    await expect(panel).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("link", { name: /Back to case queue/ }).click();
    await expect(panel).toHaveCount(0);
    await expectTotal(page, 20); // the filter is still applied
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
