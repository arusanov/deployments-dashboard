import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { ApiError } from "@/api/errors";
import type { Deployment } from "@/api/client";
import type { AttributeRow } from "./records";

type EditingState =
  | { phase: "editing" }
  | { phase: "unresolved" }
  | { phase: "rejected"; error?: ApiError }
  | { phase: "submitting"; submission: string }
  | { phase: "review"; submission: string };

interface Draft {
  version: string;
  state: EditingState;
  base: Deployment;
}

export interface InlineDraft extends Draft {
  value: string;
}

export interface AttributeDraft extends Draft {
  rows: AttributeRow[];
}

export function createDraftStore<T extends Draft>() {
  const store = createStore(() => new Map<string, T>());
  const get = (key: string) => store.getState().get(key);

  const set = (key: string, value: T | undefined) => {
    // Replace the Map while preserving every untouched draft's selector identity.
    const values = new Map(store.getState());
    if (value === undefined) {
      values.delete(key);
    } else {
      values.set(key, value);
    }

    store.setState(values, true);
  };

  return {
    ...store,
    get,
    set,
    // Claim synchronously so Enter and blur cannot submit the same version twice.
    claim: (key: string, version: string) => {
      const draft = get(key);

      if (
        !draft ||
        draft.version !== version ||
        !["editing", "unresolved", "rejected"].includes(draft.state.phase)
      ) {
        return;
      }

      const submission = crypto.randomUUID();

      set(key, {
        ...draft,
        state: { phase: "submitting", submission },
      });

      return submission;
    },
    finish: (
      key: string,
      version: string,
      submission: string,
      outcome: "saved" | "validation" | "conflict" | "unknown" | "missing",
      error?: ApiError,
    ) => {
      const draft = get(key);

      // Version protects edits made in flight; submission also protects a newer
      // retry of the same version from a late completion of its previous attempt.
      if (
        draft?.version === version &&
        "submission" in draft.state &&
        draft.state.submission === submission
      ) {
        if (outcome === "saved") {
          set(key, undefined);
        } else {
          set(key, {
            ...draft,
            state:
              outcome === "validation"
                ? { phase: "rejected", error }
                : { phase: "review", submission },
          });
        }
      }
    },
    resume: (key: string, version: string) => {
      const draft = get(key);

      if (draft?.version === version) {
        set(key, {
          ...draft,
          state:
            draft.state.phase === "editing" || draft.state.phase === "rejected"
              ? draft.state
              : { phase: "unresolved" },
        });
      }
    },
  };
}

export function useStoreDraft<T extends Draft>(
  store: ReturnType<typeof createDraftStore<T>>,
  key: string,
) {
  return useStore(store, (drafts) => drafts.get(key));
}
