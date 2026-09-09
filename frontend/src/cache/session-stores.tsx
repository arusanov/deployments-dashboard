import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createDraftStore,
  type AttributeDraft,
  type InlineDraft,
} from "@/deployments/drafts";
import { createWriteStore } from "@/deployments/mutations/write-store";
import { ToastHost, useToast } from "@/components/toast-host";
import type { ScrollAnchor } from "./windows";

export function createSessionStores() {
  // Reactive drafts use Zustand; viewport metadata has no rendering subscribers.
  return {
    inline: createDraftStore<InlineDraft>(),
    attributes: createDraftStore<AttributeDraft>(),
    windows: new Map<
      string,
      {
        lastUsed: number;
        anchor?: ScrollAnchor;
      }
    >(),
  };
}

const SessionContext = createContext<
  | (ReturnType<typeof createSessionStores> & {
      writes: ReturnType<typeof createWriteStore>;
    })
  | null
>(null);

interface Props {
  children: ReactNode;
  stores?: ReturnType<typeof createSessionStores>;
}

export function SessionStoresProvider(props: Props) {
  return (
    <ToastHost>
      <SessionStores {...props} />
    </ToastHost>
  );
}

function SessionStores({ children, stores: supplied }: Props) {
  const [stores] = useState(() => supplied ?? createSessionStores());

  const client = useQueryClient();
  const notify = useToast();

  const [session] = useState(() => ({
    ...stores,
    writes: createWriteStore(client, stores, notify),
  }));

  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        if (event.type === "removed") {
          stores.windows.delete(event.query.queryHash);
        }
      }),
    [client, stores],
  );

  return <SessionContext value={session}>{children}</SessionContext>;
}

export function useSessionStores() {
  const stores = useContext(SessionContext);

  if (!stores) {
    throw new Error("SessionStoresProvider is required");
  }

  return stores;
}
