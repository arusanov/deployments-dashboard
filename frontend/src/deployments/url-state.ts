import {
  parseAsArrayOf,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import { deploymentOptions } from "@/api/options";
import { deploymentRules } from "@/config";

export function useBrowseState() {
  return useQueryStates(
    {
      q: parseAsString.withDefault(""),
      status: parseAsArrayOf(
        parseAsStringLiteral(deploymentOptions.status),
      ).withDefault([]),
      type: parseAsArrayOf(
        parseAsStringLiteral(deploymentOptions.type),
      ).withDefault([]),
      environment: parseAsArrayOf(
        parseAsStringLiteral(deploymentOptions.environment),
      ).withDefault([]),
      sort: parseAsStringLiteral(deploymentOptions.sort).withDefault(
        deploymentRules.defaultSort,
      ),
      order: parseAsStringLiteral(deploymentOptions.order).withDefault(
        deploymentRules.defaultOrder,
      ),
      view: parseAsStringLiteral(["active", "trash"]).withDefault("active"),
      selected: parseAsString,
    },
    { shallow: true, history: "replace" },
  );
}

export type BrowseState = ReturnType<typeof useBrowseState>[0];

export type SetBrowseState = ReturnType<typeof useBrowseState>[1];
