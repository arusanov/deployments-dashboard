import { browsePolicy } from "@/config";
import { queryKeys } from "@/cache/keys";
import {
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { api } from "@/api/client";
import type { Deployment } from "@/api/client";
import type { DeploymentPage } from "@/api/client";

export function useDeploymentDetail(id: string, cached?: Deployment) {
  const client = useQueryClient();

  const detail = useQuery({
    queryKey: queryKeys.detail(id),
    queryFn: ({ signal }) => api.detail(id, signal),
    enabled: !cached,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchIntervalInBackground: false,
    initialData: () =>
      client
        .getQueriesData<InfiniteData<DeploymentPage>>({
          queryKey: queryKeys.windows,
        })
        .flatMap(([, data]) => data?.pages.flatMap((page) => page.items) ?? [])
        .filter((record) => record.deployment_id === id)
        .toSorted((first, second) => second.revision - first.revision)[0],
    // A row from an inactive window is useful immediately, but its original
    // freshness is unknown; force a read when no active list supplies this detail.
    initialDataUpdatedAt: 0,
    staleTime: browsePolicy.pollIntervalMs,
    refetchInterval: cached ? false : browsePolicy.pollIntervalMs,
  });

  const record =
    cached && (!detail.data || cached.revision >= detail.data.revision)
      ? cached
      : detail.data;

  return { detail, record };
}
