import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { SelectInput } from "./SelectInput";

describe("SelectInput", () => {
  test("renders label and select element", () => {
    const markup = renderToStaticMarkup(
      <SelectInput label="Choose an option">
        <option value="1">Option 1</option>
      </SelectInput>
    );

    expect(markup).toContain("Choose an option");
    expect(markup).toContain('<option value="1">Option 1</option>');
    expect(markup).toContain("<select");
  });

  test("uses provided id for label htmlFor and select id", () => {
    const markup = renderToStaticMarkup(
      <SelectInput label="Test Label" id="custom-id" />
    );

    expect(markup).toContain('for="custom-id"');
    expect(markup).toContain('id="custom-id"');
  });

  test("generates an id if none is provided", () => {
    const markup = renderToStaticMarkup(
      <SelectInput label="Auto ID" />
    );

    const labelFor = markup.match(/<label for="([^"]+)"/)?.[1];
    const selectId = markup.match(/<select id="([^"]+)"/)?.[1];

    expect(labelFor).toBeDefined();
    expect(selectId).toBe(labelFor);
  });

  test("appends className correctly", () => {
    const markup = renderToStaticMarkup(
      <SelectInput label="Class Name" className="custom-class" />
    );

    expect(markup).toContain('class="field custom-class"');
  });

  test("renders labelAction", () => {
    const markup = renderToStaticMarkup(
      <SelectInput label="Action" labelAction={<span className="action">Help</span>} />
    );

    expect(markup).toContain('<span class="action">Help</span>');
  });

  test("passes additional props to select element", () => {
    const markup = renderToStaticMarkup(
      <SelectInput label="Extra Props" disabled required name="test-name" />
    );

    // renderToStaticMarkup outputs boolean attributes with empty strings or missing them in older React,
    // but in newer React it might output them as `disabled=""`. We'll just check if it contains the attribute.
    expect(markup).toContain("disabled");
    expect(markup).toContain("required");
    expect(markup).toContain('name="test-name"');
  });
});
