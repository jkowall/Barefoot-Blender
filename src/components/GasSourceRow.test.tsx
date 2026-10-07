import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { GasSourceRow } from "./GasSourceRow";

const renderRow = (props: Partial<Parameters<typeof GasSourceRow>[0]> = {}): string =>
  renderToStaticMarkup(
    <GasSourceRow
      source={{ id: "air", enabled: true }}
      index={1}
      baseOptions={[{ id: "air", name: "Air", o2: 21, he: 0 }]}
      onUpdate={vi.fn()}
      onRemove={vi.fn()}
      canRemove={true}
      showDivider={false}
      pressureUnit="psi"
      {...props}
    />
  );

describe("GasSourceRow", () => {
  test("hides reorder buttons unless the fill order is the user's", () => {
    const markup = renderRow();
    expect(markup).not.toContain("Move Gas 2 up");
    expect(markup).toContain("Remove Gas 2");
    expect(markup).toContain("Limit this source to current bank pressure.");
  });

  test("shows up and down buttons and disables them at the ends", () => {
    const markup = renderRow({ showMoveControls: true, canMoveUp: true, canMoveDown: false, onMove: vi.fn() });
    // Check each button's whole opening tag: React may write disabled before or after aria-label.
    const buttonTag = (label: string): string => /<button[^>]*>/g.exec(markup.slice(markup.lastIndexOf("<button", markup.indexOf(`aria-label="${label}"`))))?.[0] ?? "";
    expect(buttonTag("Move Gas 2 up")).toContain('aria-label="Move Gas 2 up"');
    expect(buttonTag("Move Gas 2 up")).not.toContain("disabled");
    expect(buttonTag("Move Gas 2 down")).toContain("disabled");
  });

  test("uses a custom bank limit note", () => {
    expect(renderRow({ bankLimitNote: "Real-gas rise limit." })).toContain("Real-gas rise limit.");
  });
});
