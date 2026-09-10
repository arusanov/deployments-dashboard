import { useState } from "react";
import type { Deployment } from "@/api/client";
import { useSessionStores } from "@/cache/session-stores";
import { useStoreDraft } from "../drafts";
import type { Save } from "../mutations/types";

export function useInlineEditing(
  record: Deployment,
  field: "name" | "description",
  save: Save,
) {
  const store = useSessionStores().inline;

  const key = `${record.deployment_id}:${field}`;

  const draft = useStoreDraft(store, key);

  const [focus, setFocus] = useState(false);

  const cancel = () => {
    store.set(key, undefined);
  };

  const start = () => {
    setFocus(true);

    if (!store.get(key)) {
      store.set(key, {
        base: record,
        value: record.attributes[field] ?? "",
        version: crypto.randomUUID(),
        state: { phase: "editing" },
      });
    }
  };

  const commit = async (trigger: "explicit" | "blur" = "explicit") => {
    const current = store.get(key);

    if (
      !current ||
      (trigger === "blur" && current.state.phase === "rejected")
    ) {
      return;
    }

    if (
      (current.state.phase === "editing" ||
        current.state.phase === "rejected") &&
      current.value === (current.base.attributes[field] ?? "")
    ) {
      cancel();

      return;
    }

    const submission = store.claim(key, current.version);

    if (!submission) {
      return;
    }

    await save({
      record: current.base,
      action: "patch",
      attributes: { [field]: current.value },
      reconcileFirst: current.state.phase === "unresolved",
      draft: { kind: "inline", key, version: current.version, submission },
    });
  };

  return {
    draft,
    focus,
    start,
    cancel,
    commit,
    review: () => {
      const current = store.get(key);

      if (current?.state.phase === "review") {
        store.resume(key, current.version);
        void commit();
      }
    },
    change: (value: string) => {
      const current = store.get(key);

      if (current) {
        store.set(key, {
          ...current,
          value,
          version: crypto.randomUUID(),
          state: {
            phase:
              current.state.phase === "editing" ||
              current.state.phase === "rejected"
                ? "editing"
                : "unresolved",
          },
        });
      }
    },
  };
}
