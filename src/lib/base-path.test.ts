import { describe, expect, it } from "vitest";

describe("base path helpers", () => {
  it("prefixes root-relative paths only when a base path is configured", async () => {
    const { APP_BASE_PATH, withBasePath } = await import("@/lib/base-path");

    expect(withBasePath("/api/test")).toBe(APP_BASE_PATH ? `${APP_BASE_PATH}/api/test` : "/api/test");
    expect(withBasePath("https://example.com/app")).toBe("https://example.com/app");
  });
});
