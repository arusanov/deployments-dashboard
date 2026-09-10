import { Box } from "@mui/material";
import type { Deployment } from "@/api/client";

export function DeploymentMetadata({ record }: { record: Deployment }) {
  return (
    <Box
      component="dl"
      sx={{
        display: "grid",
        gridTemplateColumns: "110px minmax(0,1fr)",
        gap: 1,
        m: 0,
        "& dd": { m: 0, overflowWrap: "anywhere" },
        "& dt": { color: "text.secondary" },
      }}
    >
      {Object.entries({
        ID: record.deployment_id,
        Status: record.status,
        Type: record.type,
        Environment: record.environment,
        Version: record.version,
        Creator: record.created_by,
        Created: new Date(record.created_at).toLocaleString(),
        Updated: new Date(record.updated_at).toLocaleString(),
        Revision: record.revision,
      }).map(([key, value]) => (
        <Box key={key} sx={{ display: "contents" }}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </Box>
      ))}
    </Box>
  );
}
