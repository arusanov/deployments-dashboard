import { useCallback, useEffect, useRef, useState } from "react";
import { Stack } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import type { BrowseQuery, Deployment } from "@/api/client";
import { queryKeys } from "@/cache/keys";
import { ConnectionIndicator } from "@/components/connection-indicator";
import { createPortal } from "react-dom";
import { useToast } from "@/components/toast-host";
import {
  isInvalidCursor,
  useDeploymentPages,
} from "./hooks/use-deployment-pages";
import type { BrowseState, SetBrowseState } from "./url-state";
import type { Save } from "./mutations/types";
import { DeploymentTable } from "./table";
import Detail from "./detail";

interface Props {
  statusSlot: HTMLDivElement | null;
  params: BrowseQuery;
  windowKey: string;
  state: BrowseState;
  update: SetBrowseState;
  pending: boolean;
  save: Save;
  remove: (record: Deployment) => void;
}

type Recovery = "unused" | "resetting" | "recovered";

// Each normalized window activation gets one recovery allowance.
// Pagination cursors stay in the query cache; fresh windows start at the beginning.
export function BrowseWindow(props: Props) {
  const client = useQueryClient();
  const notify = useToast();
  const [activation] = useState(() => ({
    params: props.params,
    key: queryKeys.window(props.params),
  }));
  const [recovery, setRecovery] = useState<Recovery>("unused");
  const invalidCursor = useCallback(() => {
    setRecovery((current) => (current === "unused" ? "resetting" : current));
  }, []);

  const restart = useCallback(() => {
    const current = client.getQueryState(activation.key);
    if (current?.status === "success" && current.fetchStatus === "idle") {
      setRecovery("resetting");
    }
  }, [client, activation]);

  useEffect(() => {
    if (recovery !== "resetting") {
      return;
    }
    // The reader is already unmounted. This guard belongs to this activation,
    // so leaving and returning to the same query cannot revive old cleanup.
    let cancelled = false;
    const active = () => !cancelled;
    void (async () => {
      await client.cancelQueries({ queryKey: activation.key, exact: true });
      if (!active()) {
        return;
      }
      client.removeQueries({ queryKey: activation.key, exact: true });
      setRecovery("recovered");
      notify({
        id: crypto.randomUUID(),
        severity: "info",
        message: "The deployment list changed. Restarted at the beginning.",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [recovery, client, activation, notify]);

  if (recovery === "resetting") {
    return (
      props.statusSlot &&
      createPortal(
        <ConnectionIndicator
          status={{ kind: "updating", message: "Restarting deployment list…" }}
        />,
        props.statusSlot,
      )
    );
  }
  return (
    <DeploymentResults
      {...props}
      params={activation.params}
      recoveryUsed={recovery === "recovered"}
      invalidCursor={invalidCursor}
      restart={restart}
    />
  );
}

function DeploymentResults({
  statusSlot,
  params,
  windowKey,
  state,
  update,
  pending,
  save,
  remove,
  recoveryUsed,
  invalidCursor,
  restart,
}: Props & {
  recoveryUsed: boolean;
  invalidCursor: () => void;
  restart: () => void;
}) {
  const { query, rows, status, load } = useDeploymentPages(
    params,
    recoveryUsed,
  );
  const trash = state.view === "trash";
  const notify = useToast();
  const errorEpisode = useRef(false);
  const automaticReset = !recoveryUsed && isInvalidCursor(query.error);
  useEffect(() => {
    if (status.kind === "online") {
      errorEpisode.current = false;
    } else if (
      !automaticReset &&
      (status.kind === "error" || status.kind === "offline") &&
      !errorEpisode.current
    ) {
      errorEpisode.current = true;
      notify({
        id: crypto.randomUUID(),
        severity: status.kind === "error" ? "error" : "warning",
        message: status.message ?? "Connection unavailable. Retry to continue.",
      });
    }
  }, [status.kind, status.message, automaticReset, notify]);
  useEffect(() => {
    if (!recoveryUsed && isInvalidCursor(query.error)) {
      invalidCursor();
    }
  }, [query.error, recoveryUsed, invalidCursor]);

  // Portal only the presentation: the reader remains the sole query observer,
  // while the header slot stays mounted through window changes and recovery.
  return (
    <Stack component="section" aria-label="Deployment results" spacing={1}>
      {statusSlot &&
        createPortal(
          <ConnectionIndicator
            status={status}
            loading={query.isFetching || query.isPending}
            retry={() => {
              void query.refetch({ cancelRefetch: false });
            }}
          />,
          statusSlot,
        )}
      <DeploymentTable
        rows={rows}
        trash={trash}
        loading={query.isPending}
        unavailable={query.isError}
        fetching={query.isFetching}
        adjacent={query.isFetchingNextPage || query.isFetchingPreviousPage}
        pending={pending}
        state={state}
        update={update}
        save={save}
        remove={remove}
        windowKey={windowKey}
        hasNext={query.hasNextPage}
        hasPrevious={query.hasPreviousPage}
        load={load}
        restart={restart}
      />
      {state.selected && (
        <Detail
          key={state.selected}
          id={state.selected}
          cached={rows.find(
            (record) => record.deployment_id === state.selected,
          )}
          close={() => {
            void update({ selected: null });
          }}
          save={save}
          pending={pending}
        />
      )}
    </Stack>
  );
}
