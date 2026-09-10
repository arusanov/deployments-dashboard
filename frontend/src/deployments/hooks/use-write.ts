import { useStore } from "zustand";
import { useSessionStores } from "@/cache/session-stores";

export function useWrite() {
  const store = useSessionStores().writes;
  const state = useStore(store);
  return { ...store, ...state, pending: state.phase !== "idle" };
}
