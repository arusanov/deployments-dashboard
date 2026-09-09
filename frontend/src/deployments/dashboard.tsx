"use client";
import { useEffect, useMemo, useState } from "react";
import { Box, Stack, Tab, Tabs } from "@mui/material";
import type { Deployment } from "@/api/client";
import { deploymentRules } from "@/config";
import { hashKey } from "@tanstack/react-query";
import { browseParameters, queryKeys } from "@/cache/keys";
import { useBrowseState } from "./url-state";
import { useWrite } from "./hooks/use-write";
import { DeploymentHeader } from "./header";
import { DeploymentFilters } from "./filters";
import { DeleteDialog } from "./delete-dialog";
import { WriteFeedback } from "./mutations/write-feedback";
import { BrowseWindow } from "./browse-window";

import { useToast } from "@/components/toast-host";

export default function Dashboard() {
  const [state, update] = useBrowseState();
  const { q, status, type, environment, sort, order, view } = state;
  const params = useMemo(
    () => browseParameters({ q, status, type, environment, sort, order, view }),
    [q, status, type, environment, sort, order, view],
  );
  const windowKey = hashKey(queryKeys.window(params));
  const trash = view === "trash";
  const write = useWrite();

  const [statusSlot, setStatusSlot] = useState<HTMLDivElement | null>(null);
  const notify = useToast();
  useEffect(() => {
    if (trash) {
      notify({
        id: crypto.randomUUID(),
        severity: "info",
        message: `Deleted deployments can be restored for ${deploymentRules.recoveryDays} days.`,
      });
    }
  }, [trash, notify]);

  const [deleting, setDeleting] = useState<Deployment>();

  return (
    <Box
      component="main"
      sx={{ p: { xs: 2, md: 4 }, maxWidth: 1920, mx: "auto" }}
    >
      <Stack spacing={3}>
        <DeploymentHeader statusRef={setStatusSlot} />
        <WriteFeedback {...write} />
        <Tabs
          value={state.view}
          onChange={(_, value: "active" | "trash") => {
            void update({ view: value });
          }}
          aria-label="Deployment views"
        >
          <Tab label="Active" value="active" />
          <Tab label="Trash" value="trash" />
        </Tabs>
        <DeploymentFilters
          state={state}
          update={update}
          windowKey={windowKey}
        />
        <BrowseWindow
          statusSlot={statusSlot}
          key={windowKey}
          params={params}
          windowKey={windowKey}
          state={state}
          update={update}
          pending={write.pending}
          save={write.execute}
          remove={setDeleting}
        />
      </Stack>
      <DeleteDialog
        record={deleting}
        pending={write.pending}
        close={() => {
          setDeleting(undefined);
        }}
        confirm={(record) => {
          setDeleting(undefined);
          void write.execute({ record, action: "delete" });
        }}
      />
    </Box>
  );
}
