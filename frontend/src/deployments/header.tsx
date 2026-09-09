import type { Ref } from "react";
import { Box, Stack, Typography } from "@mui/material";

export function DeploymentHeader({
  statusRef,
}: {
  statusRef: Ref<HTMLDivElement>;
}) {
  return (
    <Stack
      component="header"
      direction="row"
      spacing={1}
      sx={{ alignItems: "center" }}
    >
      <Typography component="h1" variant="overline" color="primary">
        DEPLOYMENTS
      </Typography>
      <Box ref={statusRef} sx={{ width: 28, height: 28, flexShrink: 0 }} />
    </Stack>
  );
}
