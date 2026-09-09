import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  createSessionStores,
  SessionStoresProvider,
} from "../src/cache/session-stores";

export function testSession() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const stores = createSessionStores();

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SessionStoresProvider stores={stores}>{children}</SessionStoresProvider>
    </QueryClientProvider>
  );

  return { client, stores, wrapper };
}
