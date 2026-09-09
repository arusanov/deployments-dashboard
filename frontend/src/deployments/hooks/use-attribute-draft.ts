import { useStoreDraft, type AttributeDraft } from "../drafts";
import { useSessionStores } from "@/cache/session-stores";
import { useState } from "react";
import type { Deployment } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { attributeRows, buildPatch } from "../records";
import type { Save } from "../mutations/types";

export function useAttributeDraft(id: string, save: Save) {
  const store = useSessionStores().attributes;

  const draft = useStoreDraft(store, id);

  const setDraft = (value: Omit<AttributeDraft, "version"> | undefined) => {
    store.set(
      id,
      value && {
        ...value,
        version: crypto.randomUUID(),
        state: {
          phase:
            value.state.phase === "editing" || value.state.phase === "rejected"
              ? "editing"
              : "unresolved",
        },
      },
    );
  };

  const [error, setError] = useState("");

  const cancel = () => {
    setDraft(undefined);
    setError("");
  };

  const begin = (record: Deployment) => {
    setDraft({
      base: record,
      rows: attributeRows(record.attributes),
      state: { phase: "editing" },
    });
    setError("");
  };

  const change = (index: number, field: "key" | "value", value: string) => {
    const previous = draft;

    setDraft(
      previous && {
        ...previous,
        rows: previous.rows.map((row, position) =>
          position === index ? { ...row, [field]: value } : row,
        ),
      },
    );
  };

  const remove = (index: number) => {
    const previous = draft;

    setDraft(
      previous && {
        ...previous,
        rows: previous.rows.filter((_, position) => index !== position),
      },
    );
  };

  const add = () => {
    const previous = draft;

    setDraft(
      previous && {
        ...previous,
        rows: [
          ...previous.rows,
          { id: crypto.randomUUID(), key: "", value: "" },
        ],
      },
    );
  };

  const submit = async () => {
    if (!draft || draft.state.phase === "submitting") {
      return;
    }

    try {
      const attributes = buildPatch(draft.base.attributes, draft.rows);

      if (
        Object.keys(attributes).length === 0 &&
        (draft.state.phase === "editing" || draft.state.phase === "rejected")
      ) {
        cancel();

        return;
      }

      if (draft.state.phase === "review") {
        store.resume(id, draft.version);
      }

      const submission = store.claim(id, draft.version);

      if (!submission) {
        return;
      }

      setError("");

      await save({
        record: draft.base,
        action: "patch",
        attributes,
        desiredAttributes: Object.fromEntries(
          draft.rows.map(({ key, value }) => [key, value]),
        ),
        reconcileFirst:
          draft.state.phase === "unresolved" || draft.state.phase === "review",
        draft: {
          kind: "attributes",
          key: id,
          version: draft.version,
          submission,
        },
      });
    } catch (error) {
      setError(errorMessage(error, "Invalid attributes."));
    }
  };

  const validation =
    draft?.state.phase === "rejected" ? draft.state.error : undefined;
  return {
    draft,
    error: error || (validation?.message ?? ""),
    validation,
    begin,
    cancel,
    change,
    add,
    remove,
    submit,
  };
}
