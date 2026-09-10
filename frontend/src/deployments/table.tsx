import { TableHeader } from "./table-header";
import { tableComponents } from "./table-components";
import { useCallback, useLayoutEffect, useState } from "react";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import { TableVirtuoso } from "react-virtuoso";
import type { Deployment } from "@/api/client";
import { DeploymentCells } from "./columns";
import { useScrollAnchor } from "./hooks/use-scroll-anchor";
import type { BrowseState, SetBrowseState } from "./url-state";
import type { Save } from "./mutations/types";

import { useScrollability } from "./hooks/use-scrollability";
import { BoundaryController } from "./hooks/boundary-controller";

interface Props {
  rows: Deployment[];
  trash: boolean;
  loading: boolean;
  unavailable?: boolean;
  fetching: boolean;
  adjacent: boolean;
  pending: boolean;
  state: BrowseState;
  update: SetBrowseState;
  save: Save;
  remove: (record: Deployment) => void;
  windowKey: string;
  hasNext: boolean;
  hasPrevious: boolean;
  restart: () => void;
  load: (direction: "next" | "previous") => Promise<void>;
}

export function DeploymentTable({
  rows,
  trash,
  loading,
  unavailable,
  fetching,
  adjacent,
  pending,
  state,
  update,
  save,
  remove,
  windowKey,
  hasNext,
  hasPrevious,
  load,
  restart,
}: Props) {
  const [boundary] = useState(() => new BoundaryController());

  const { virtuosoRef, setScroller, measure, heightChanged } = useScrollAnchor(
    rows,
    windowKey,
    (delta) => {
      boundary.moved(delta);
      requestAnimationFrame(() => {
        boundary.reconsider();
      });
    },
    (active) => {
      boundary.positioning(active);
    },
  );

  const {
    setScroller: setMeasuredScroller,
    measure: measureDimensions,
    heightChanged: dimensionsChanged,
    scrollable,
  } = useScrollability();
  const attachScroller = useCallback(
    (element: HTMLElement | Window | null) => {
      setScroller(element);
      setMeasuredScroller(element);
    },
    [setScroller, setMeasuredScroller],
  );
  const stranded =
    !loading &&
    !unavailable &&
    (hasNext || hasPrevious) &&
    (rows.length === 0 || scrollable === false);
  const hasFilters =
    state.q.trim() !== "" ||
    state.status.length > 0 ||
    state.type.length > 0 ||
    state.environment.length > 0;

  useLayoutEffect(() => {
    boundary.update(
      rows.length,
      fetching,
      hasNext,
      hasPrevious,
      (direction) => {
        void load(direction);
      },
      adjacent,
    );
    const frame = requestAnimationFrame(() => {
      boundary.reconsider();
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [load, boundary, rows.length, fetching, hasNext, hasPrevious, adjacent]);

  useLayoutEffect(
    () => () => {
      boundary.dispose();
    },
    [boundary],
  );

  return (
    <Stack spacing={1} data-retained-rows={rows.length}>
      {stranded && (
        <Alert
          severity="info"
          action={
            <Button onClick={restart} disabled={fetching}>
              Restart browsing
            </Button>
          }
        >
          This batch cannot scroll to adjacent deployments.
        </Alert>
      )}
      <Box
        sx={{
          position: "relative",
          height: "min(720px, 70vh)",
          minHeight: 400,
          width: "100%",
          bgcolor: "background.paper",
        }}
      >
        <TableVirtuoso
          tabIndex={0}
          data={rows}
          components={tableComponents}
          ref={virtuosoRef}
          totalListHeightChanged={(height) => {
            heightChanged(height);
            dimensionsChanged(height);
          }}
          scrollerRef={attachScroller}
          computeItemKey={(_, record) => record.deployment_id}
          aria-label={trash ? "Deleted deployments" : "Active deployments"}
          rangeChanged={(range) => {
            boundary.rangeChanged(range);
            measure();
            measureDimensions();
          }}
          increaseViewportBy={144}
          fixedHeaderContent={() => (
            <TableHeader state={state} update={update} />
          )}
          itemContent={(_, record) => (
            <DeploymentCells
              record={record}
              pending={pending}
              save={save}
              remove={remove}
              open={(selected) => {
                void update({ selected: selected.deployment_id });
              }}
            />
          )}
        />
        {!loading && rows.length === 0 && (
          <Box
            sx={{
              position: "absolute",
              inset: "56px 0 0",
              display: "grid",
              placeItems: "center",
              pointerEvents: "none",
              p: 2,
            }}
          >
            <Typography role="status" color="text.secondary" align="center">
              {unavailable
                ? "Deployments unavailable. Use the connection indicator to retry."
                : hasNext || hasPrevious
                  ? "No deployments in this batch. Restart browsing to return to the beginning."
                  : hasFilters
                    ? "No deployments match these filters"
                    : trash
                      ? "Trash is empty"
                      : "No deployments"}
            </Typography>
          </Box>
        )}
      </Box>
    </Stack>
  );
}
