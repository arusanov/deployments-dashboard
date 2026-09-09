import { apiUrl, type BrowseQuery } from "@/api/client";
import type { BrowseState } from "@/deployments/url-state";

export function browseParameters(
  state: Omit<BrowseState, "selected">,
): BrowseQuery {
  return {
    q: state.q.trim().toLowerCase(),
    status: [...new Set(state.status)].toSorted(),
    type: [...new Set(state.type)].toSorted(),
    environment: [...new Set(state.environment)].toSorted(),
    sort_by: state.sort,
    sort_order: state.order,
    deleted: state.view === "trash" ? "only" : "exclude",
    limit: 50,
  };
}

export const queryKeys = {
  windows: ["deployments", apiUrl] as const,
  window: (params: BrowseQuery) => ["deployments", apiUrl, params] as const,
  detail: (id: string) => ["detail", apiUrl, id] as const,
};
