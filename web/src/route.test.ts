import { describe, expect, it } from "vitest";
import { accountFromPath, accountHref, isModifiedClick } from "./route";

describe("account routes", () => {
  it("round-trips account numbers through the path", () => {
    expect(accountHref("DEMO-700011")).toBe("/accounts/DEMO-700011");
    expect(accountFromPath("/accounts/DEMO-700011")).toBe("DEMO-700011");
    expect(accountFromPath("/accounts/DEMO-700011/")).toBe("DEMO-700011");
    expect(accountFromPath(accountHref("a b/c"))).toBe("a b/c");
  });

  it("treats every other path as the queue, including old case links", () => {
    for (const p of ["/", "/accounts", "/accounts/", "/accounts/a/b", "/other/DEMO-1", "/accounts/%E0%A4%A", "/cases/GS-2011"]) expect(accountFromPath(p)).toBeNull();
  });

  it("leaves modified clicks to the browser", () => {
    const base = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, button: 0 };
    expect(isModifiedClick(base)).toBe(false);
    expect(isModifiedClick({ ...base, ctrlKey: true })).toBe(true);
    expect(isModifiedClick({ ...base, metaKey: true })).toBe(true);
    expect(isModifiedClick({ ...base, button: 1 })).toBe(true);
  });
});

describe("pages", () => {
  it("knows the queue, case pages and the Flowchart page", async () => {
    const { pageFromPath } = await import("./route");
    expect(pageFromPath("/")).toBe("classic");
    expect(pageFromPath("/outlook/new")).toBe("outlook");
    expect(pageFromPath("/queue")).toBe("queue");
    expect(pageFromPath("/funnel")).toBe("funnel");
    expect(pageFromPath("/bts/weather-outlook")).toBe("outlookmodel");
    expect(pageFromPath("/flowchart")).toBe("admin");
    expect(pageFromPath("/flowchart/")).toBe("admin");
    expect(pageFromPath("/admin")).toBe("admin"); // old links still work
    expect(pageFromPath("/flowchart/extra")).toBe("classic");
    expect(pageFromPath("/accounts/DEMO-700011")).toBe("case");
    expect(pageFromPath("/cases/GS-2011")).toBe("classic");
  });
});
