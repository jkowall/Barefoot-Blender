import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import TankContextFields from "./TankContextFields";

describe("TankContextFields", () => {
  test("renders tank inputs without derived PSI or free-liter stats", () => {
    const markup = renderToStaticMarkup(
      <TankContextFields
        tankSizeCuFt={80}
        tankRatedPressurePsi={3000}
        onChange={vi.fn()}
      />
    );

    expect(markup).toContain("Tank Volume (cu ft)");
    expect(markup).toContain("Rated Pressure (PSI)");
    expect(markup).not.toContain("PSI per cu ft");
    expect(markup).not.toContain("Free gas liters");
    expect(markup).not.toContain("free gas liters");
  });
});
