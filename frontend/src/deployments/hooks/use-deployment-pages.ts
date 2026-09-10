import { browsePolicy } from "@/config";
import { useEffect, useMemo, useRef } from "react";
import {
  hashKey,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, type BrowseQuery, type DeploymentPage } from "@/api/client";
import { ApiError } from "@/api/errors";
import { queryKeys } from "@/cache/keys";
import { useSessionStores } from "@/cache/session-stores";
import { limitWindows, windowRows } from "@/cache/windows";
import { syncStatus } from "@/cache/sync-status";

export function isInvalidCursor(error: unknown) {
  return error instanceof ApiError && error.code === "invalid_cursor";
}

function canAutomaticallyFetch(error: unknown, recoveryUsed: boolean) {
  return !error || (!recoveryUsed && !isInvalidCursor(error));
}

export function useDeploymentPages(params: BrowseQuery, recoveryUsed: boolean) {
  const client = useQueryClient();
  const stores = useSessionStores();
  const key = useMemo(() => queryKeys.window(params), [params]);
  const windowKey = hashKey(key);
  const loadingPage = useRef(false);
  const mounted = useRef(false);
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }): Promise<DeploymentPage> =>
      api.browse({ ...params, cursor: pageParam }, signal),
    // TanStack refreshes the retained chain sequentially with fresh continuations;
    // independently refetching old page cursors would skip or duplicate moved rows.
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor,
    getPreviousPageParam: (page) => page.previous_cursor,
    maxPages: browsePolicy.maxPages,
    enabled: (current) =>
      canAutomaticallyFetch(current.state.error, recoveryUsed),
    gcTime: browsePolicy.inactiveMs,
    staleTime: browsePolicy.pollIntervalMs,
    refetchInterval: browsePolicy.pollIntervalMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    retry: false,
  });

  useEffect(() => {
    mounted.current = true;
    limitWindows(client, windowKey, stores.windows);
    return () => {
      mounted.current = false;
      void client.cancelQueries({ queryKey: key, exact: true });
    };
  }, [client, windowKey, key, stores]);

  const load = async (direction: "next" | "previous") => {
    // A boundary callback may precede React's next render of the query result.
    const current = client.getQueryState(key);
    if (
      !mounted.current ||
      !current ||
      !canAutomaticallyFetch(current.error, recoveryUsed) ||
      current.fetchStatus !== "idle" ||
      loadingPage.current
    ) {
      return;
    }
    loadingPage.current = true;
    try {
      if (direction === "next" && query.hasNextPage) {
        await query.fetchNextPage({ cancelRefetch: false });
      }
      if (direction === "previous" && query.hasPreviousPage) {
        await query.fetchPreviousPage({ cancelRefetch: false });
      }
    } finally {
      loadingPage.current = false;
    }
  };

  return {
    query,
    status: syncStatus(query),
    rows: useMemo(() => windowRows(query.data?.pages ?? []), [query.data]),
    load,
  };
}
