import type { AttributePatch } from "@/api/client";

export interface AttributeRow {
  id: string;
  key: string;
  value: string;
}

export const attributeRows = (
  attributes: Record<string, string>,
): AttributeRow[] =>
  Object.entries(attributes).map(([key, value]) => ({ id: key, key, value }));

export function buildPatch(
  original: Record<string, string>,
  rows: AttributeRow[],
): AttributePatch {
  const next = new Map<string, string>();

  for (const { key, value } of rows) {
    if (next.has(key)) {
      throw new Error(`Duplicate attribute: ${key}`);
    }

    next.set(key, value);
  }

  return Object.fromEntries<string | null>([
    ...Object.keys(original)
      .filter((key) => !next.has(key))
      .map((key): [string, null] => [key, null]),
    ...[...next].filter(
      ([key, value]) =>
        !Object.hasOwn(original, key) || original[key] !== value,
    ),
  ]);
}
