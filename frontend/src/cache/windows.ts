import { browsePolicy } from "@/config";
import type { createSessionStores } from "./session-stores";
import type { QueryClient } from "@tanstack/react-query";
import type { Deployment, DeploymentPage } from "@/api/client";

export interface ScrollAnchor {
  id: string;
  offset: number;
}

export function windowRows(pages: DeploymentPage[]): Deployment[] {
  const records = pages.flatMap((page) => page.items);

  // Live updates can move an ID across cursor boundaries. Display its newest
  // revision at its returned position without rewriting cached pages or cursors.
  const positions = new Map<string, { revision: number; index: number }>();

  for (const [index, record] of records.entries()) {
    const previous = positions.get(record.deployment_id);

    if (!previous || previous.revision < record.revision) {
      positions.set(record.deployment_id, { revision: record.revision, index });
    }
  }

  return records.filter(
    (record, index) => positions.get(record.deployment_id)?.index === index,
  );
}

export function limitWindows(
  client: QueryClient,
  activeHash: string,
  store: ReturnType<typeof createSessionStores>["windows"],
) {
  store.set(activeHash, { ...store.get(activeHash), lastUsed: Date.now() });
  const windows = client.getQueryCache().findAll({ queryKey: ["deployments"] });

  const inactive = windows
    .filter((query) => query.queryHash !== activeHash && !query.isActive())
    .toSorted(
      (a, b) =>
        (store.get(a.queryHash)?.lastUsed ?? 0) -
        (store.get(b.queryHash)?.lastUsed ?? 0),
    );

  for (const query of inactive.slice(
    0,
    Math.max(0, windows.length - browsePolicy.maxWindows),
  )) {
    client.removeQueries({ queryKey: query.queryKey, exact: true });
    store.delete(query.queryHash);
  }
}
