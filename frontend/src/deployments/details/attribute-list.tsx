import { Box, Stack, Typography } from "@mui/material";
import type { Deployment } from "@/api/client";

export function AttributeList({ record }: { record: Deployment }) {
  return (
    <Stack spacing={2}>
      {Object.entries(record.attributes).map(([key, value]) => (
        <Box key={key} sx={{ overflowWrap: "anywhere" }}>
          <Typography color="text.secondary">{key}</Typography>
          <Typography sx={{ whiteSpace: "pre-wrap" }}>
            {value || "(empty)"}
          </Typography>
        </Box>
      ))}
      {Object.keys(record.attributes).length === 0 && (
        <Typography color="text.secondary">No attributes yet.</Typography>
      )}
    </Stack>
  );
}
