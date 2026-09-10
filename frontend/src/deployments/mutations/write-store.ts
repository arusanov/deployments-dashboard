import { createStore } from "zustand/vanilla";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import {
  api,
  type Deployment,
  type DeploymentPage,
  type Deletion,
} from "@/api/client";
import type { Notify } from "@/components/toast-host";
import { ApiError } from "@/api/errors";
import { deploymentRules } from "@/config";
import { queryKeys } from "@/cache/keys";
import type { createSessionStores } from "@/cache/session-stores";
import type { Review, Write, WriteOutcome } from "./types";

interface Snapshot {
  phase: "idle" | "submitting" | "reconciling";
  review?: Review;
}

export function intendedResult(write: Write, current: Deployment) {
  if (write.action === "delete") {
    return Boolean(current.deleted_at);
  }

  if (write.action === "restore") {
    return !current.deleted_at;
  }

  return (
    !current.deleted_at &&
    Object.entries(write.attributes ?? {}).every(([key, value]) =>
      value === null
        ? !Object.hasOwn(current.attributes, key)
        : current.attributes[key] === value,
    )
  );
}

function savedNotice(action: Write["action"]) {
  switch (action) {
    case "delete": {
      return `Moved to Trash. Recoverable for ${deploymentRules.recoveryDays} days.`;
    }

    case "restore": {
      return "Deployment restored.";
    }

    case "patch": {
      return "Changes saved.";
    }
  }
}

function dispatch({ record, action, attributes }: Write) {
  switch (action) {
    case "patch": {
      return api.patch(record.deployment_id, record.revision, attributes ?? {});
    }

    case "delete": {
      return api.delete(record.deployment_id, record.revision);
    }

    case "restore": {
      return api.restore(record.deployment_id, record.revision);
    }
  }
}

function failureKind(error: unknown) {
  if (!(error instanceof ApiError)) {
    return "unknown";
  }

  switch (error.status) {
    case 422:
    case 428: {
      return "validation";
    }

    case 412:
    case 409: {
      return "conflict";
    }

    case 404: {
      return "missing";
    }

    default: {
      return "unknown";
    }
  }
}

// Provider-owned completion survives editor unmount and reconciles uncertain writes.
export function createWriteStore(
  query: QueryClient,
  stores: ReturnType<typeof createSessionStores>,
  notify: Notify,
) {
  const store = createStore<Snapshot>(() => ({ phase: "idle" }));
  const set = (value: Snapshot) => store.setState(value, true);
  let check: AbortController | undefined;
  // Dialog dismissal must not forget an operation that may have reached the server.
  const unresolved = new Map<string, Write>();

  const finish = (
    write: Write,
    outcome: WriteOutcome["kind"],
    error?: ApiError,
  ) => {
    if (write.draft) {
      const { kind, key, version, submission } = write.draft;

      stores[kind].finish(key, version, submission, outcome, error);
    }
  };

  const resume = (write: Write) => {
    if (write.draft) {
      stores[write.draft.kind].resume(write.draft.key, write.draft.version);
    }
  };

  const acceptDetail = async (record: Deployment) => {
    await query.cancelQueries({
      queryKey: queryKeys.detail(record.deployment_id),
    });
    const current = query.getQueryData<Deployment>(
      queryKeys.detail(record.deployment_id),
    );

    if (!current || current.revision <= record.revision) {
      query.setQueryData(queryKeys.detail(record.deployment_id), record);
    }
  };

  const saved = async (
    write: Write,
    result: Deployment | Deletion,
  ): Promise<WriteOutcome> => {
    set({ ...store.getState(), phase: "submitting" });
    // Cancel stale reads before accepting the server's acknowledged revision.
    await query.cancelQueries({ queryKey: queryKeys.windows });
    if ("attributes" in result) {
      await acceptDetail(result);
      query.setQueriesData<InfiniteData<DeploymentPage>>(
        { queryKey: queryKeys.windows },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              // Preserve membership, ordering and cursors until the server refreshes.
              items: page.items.map((record) =>
                record.deployment_id === result.deployment_id &&
                record.revision < result.revision
                  ? result
                  : record,
              ),
            })),
          },
      );
    } else {
      await query.cancelQueries({
        queryKey: queryKeys.detail(write.record.deployment_id),
      });
      void query.invalidateQueries({
        queryKey: queryKeys.detail(write.record.deployment_id),
      });
    }

    unresolved.delete(write.record.deployment_id);
    finish(write, "saved");
    set({ phase: "idle" });
    notify({
      id: crypto.randomUUID(),
      message: savedNotice(write.action),
      severity: "success",
    });
    // Read errors belong to the results query; acknowledgement remains final.
    void query.invalidateQueries({
      queryKey: queryKeys.windows,
      refetchType: "active",
    });
    return { kind: "saved" };
  };

  const reconcile = async (write: Write, message: string) => {
    const review = store.getState().review;

    if (review?.write !== write || store.getState().phase !== "idle") {
      return;
    }

    const controller = new AbortController();

    check = controller;
    // Cancellation alone is insufficient if the response already resolved before
    // dismissal; the review identity prevents that result from reopening old work.
    const isCurrent = () =>
      !controller.signal.aborted && store.getState().review?.id === review.id;

    set({ ...store.getState(), phase: "reconciling" });
    try {
      const current = await api.detail(
        write.record.deployment_id,
        controller.signal,
      );

      if (!isCurrent()) {
        return;
      }

      await acceptDetail(current);
      if (!isCurrent()) {
        return;
      }

      set({
        ...store.getState(),
        phase: "idle",
        review: { ...review, current, message, canReconcile: false },
      });
    } catch (error) {
      if (!isCurrent()) {
        return;
      }

      const missing = error instanceof ApiError && error.status === 404;

      set({
        ...store.getState(),
        phase: "idle",
        review: {
          ...review,
          message: missing
            ? "This deployment is missing or its recovery period has expired. Your draft is preserved."
            : `${message} Current state could not be loaded. Reconnect, then check again before retrying.`,
          canReconcile: !missing,
        },
      });
    }
  };

  const execute = async (input: Write): Promise<WriteOutcome | undefined> => {
    if (store.getState().phase !== "idle") {
      resume(input);

      return;
    }

    check?.abort();
    const previous = unresolved.get(input.record.deployment_id);
    let attributes = input.attributes;
    // A dismissed write may already have applied. Keep all possibly touched keys
    // for reconciliation, including removals absent from the latest base-to-draft diff.
    if (input.action === "patch" && previous?.action === "patch") {
      attributes = { ...previous.attributes, ...attributes };
      const desired = input.desiredAttributes;
      if (desired) {
        attributes = Object.fromEntries(
          Object.keys(attributes).map((key) => [
            key,
            Object.hasOwn(desired, key) ? (desired[key] ?? null) : null,
          ]),
        );
      }
    }
    const write: Write = Object.freeze({
      ...input,
      record: Object.freeze({
        ...input.record,
        attributes: Object.freeze({ ...input.record.attributes }),
      }),
      attributes: attributes && Object.freeze({ ...attributes }),
      desiredAttributes:
        input.desiredAttributes &&
        Object.freeze({ ...input.desiredAttributes }),
      draft: input.draft && Object.freeze({ ...input.draft }),
    });

    if (write.reconcileFirst || previous) {
      unresolved.set(write.record.deployment_id, write);
      finish(write, "unknown");
      const message =
        "Check the current state before explicitly retrying your draft.";

      set({
        ...store.getState(),
        review: { id: crypto.randomUUID(), write, message, canReconcile: true },
      });
      await reconcile(write, message);

      return { kind: "unknown" };
    }

    set({ phase: "submitting" });
    let result: Deployment | Deletion;

    try {
      result = await dispatch(write);
    } catch (error) {
      const kind = failureKind(error);
      let message =
        error instanceof Error
          ? error.message
          : "The save could not be confirmed.";

      if (kind === "conflict") {
        message =
          "Someone changed this deployment. Review the current values beside your draft before retrying.";
      }

      finish(write, kind, error instanceof ApiError ? error : undefined);
      if (kind === "validation" && write.draft) {
        set({ phase: "idle" });
        return { kind };
      }
      if (kind === "conflict" || kind === "unknown") {
        unresolved.set(write.record.deployment_id, write);
      }
      set({
        phase: "idle",
        review: {
          id: crypto.randomUUID(),
          write,
          message,
          canReconcile: kind === "conflict" || kind === "unknown",
        },
      });
      if (kind === "conflict" || kind === "unknown") {
        await reconcile(write, message);
      }

      return { kind };
    }

    return saved(write, result);
  };

  return {
    ...store,
    execute,
    reconcile,
    retryReview: async () => {
      const review = store.getState().review;

      if (!review?.current || store.getState().phase !== "idle") {
        return;
      }

      let draft = review.write.draft;

      if (draft) {
        resume(review.write);
        const submission = stores[draft.kind].claim(draft.key, draft.version);

        if (!submission) {
          return;
        }

        draft = { ...draft, submission };
      }

      unresolved.delete(review.write.record.deployment_id);
      await execute({
        ...review.write,
        draft,
        record: review.current,
        reconcileFirst: false,
      });
    },
    acceptReview: async () => {
      const review = store.getState().review;

      if (
        store.getState().phase === "idle" &&
        review?.current &&
        intendedResult(review.write, review.current)
      ) {
        await saved(review.write, review.current);
      }
    },
    dismissReview: () => {
      check?.abort();
      const review = store.getState().review;

      if (review) {
        resume(review.write);
      }

      set({ phase: "idle" });
    },
  };
}
