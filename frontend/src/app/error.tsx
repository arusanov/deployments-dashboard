"use client";

import { Alert, Box, Button, Typography } from "@mui/material";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <Box component="main" sx={{ p: 4 }}>
      <Typography component="h1" variant="h4" sx={{ mb: 3 }}>
        Deployments
      </Typography>
      <Alert severity="error" action={<Button onClick={reset}>Retry</Button>}>
        The dashboard encountered an unexpected error. Retry to reopen it.
      </Alert>
    </Box>
  );
}
