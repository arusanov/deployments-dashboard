import { describe, expect, it } from "vitest";
import { attributeRows, buildPatch } from "../src/deployments/records";

describe("attribute patches", () => {
  it("combines renames, additions and removals without unchanged operations", () => {
    expect(
      buildPatch({ old: "value", keep: "same" }, [
        { id: "1", key: "new", value: "value" },
        { id: "2", key: "keep", value: "same" },
      ]),
    ).toEqual({ old: null, new: "value" });
    expect(buildPatch({ name: "" }, attributeRows({ name: "" }))).toEqual({});
  });
  it("rejects duplicate keys before converting rows to a patch", () => {
    expect(() =>
      buildPatch({}, [
        { id: "1", key: "a", value: "first" },
        { id: "2", key: "a", value: "second" },
      ]),
    ).toThrow("Duplicate");
  });
  it("handles prototype-like keys and preserves Unicode values", () => {
    expect(
      buildPatch({}, [{ id: "1", key: "__proto__", value: "safe" }]),
    ).toEqual(JSON.parse('{"__proto__":"safe"}'));
    expect(
      buildPatch({}, [{ id: "1", key: "地域", value: "東京 😀" }]),
    ).toEqual({ 地域: "東京 😀" });
  });
});
