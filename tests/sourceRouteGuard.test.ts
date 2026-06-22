import { describe, expect, it } from "vitest";
import { shouldRedirectSourceNavigation } from "../src/dev/sourceRouteGuard";

describe("source route guard", () => {
  it("redirects direct document visits to source modules", () => {
    expect(
      shouldRedirectSourceNavigation({
        method: "GET",
        url: "/src/input/inputMapping.ts",
        headers: { "sec-fetch-dest": "document", accept: "text/html" },
      }),
    ).toBe(true);
  });

  it("leaves Vite module requests alone", () => {
    expect(
      shouldRedirectSourceNavigation({
        method: "GET",
        url: "/src/input/inputMapping.ts",
        headers: { "sec-fetch-dest": "script", accept: "*/*" },
      }),
    ).toBe(false);
  });

  it("does not redirect the game root", () => {
    expect(
      shouldRedirectSourceNavigation({
        method: "GET",
        url: "/",
        headers: { "sec-fetch-dest": "document", accept: "text/html" },
      }),
    ).toBe(false);
  });
});
