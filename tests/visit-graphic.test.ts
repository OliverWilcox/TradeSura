import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GRAPHIC_KEYS } from "@/lib/admin/content";
import { VISIT_REASONS, defaultContent } from "@/lib/visit-reasons";
import { VisitGraphic, hasGraphic } from "@/components/visit-graphic";

const draw = (graphicKey: string | null) => renderToStaticMarkup(createElement(VisitGraphic, { graphicKey }));

describe("the visit-reason graphic", () => {
  it("has a drawing for every key the admin offers and every shipped default", () => {
    for (const key of GRAPHIC_KEYS) expect(hasGraphic(key), key).toBe(true);
    for (const r of VISIT_REASONS) expect(hasGraphic(defaultContent(r).graphicKey ?? ""), r).toBe(true);
  });

  it("draws decorative line art for a known key, and nothing for an unknown or empty one", () => {
    const html = draw("repair");
    expect(html).toContain('data-graphic="repair"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("<svg");
    expect(draw(null)).toBe("");
    expect(draw("not-a-key")).toBe("");
    expect(draw("toString")).toBe("");
  });
});
