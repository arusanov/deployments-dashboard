import { Button, Chip, Stack, Tooltip } from "@mui/material";
import type { Deployment } from "@/api/client";

export function AttributeTags({
  record,
  open,
}: {
  record: Deployment;
  open: (record: Deployment) => void;
}) {
  const keys = Object.keys(record.attributes)
    .filter((key) => key !== "name" && key !== "description")
    .toSorted();

  if (keys.length === 0) {
    return "—";
  }

  return (
    <Stack
      direction="row"
      spacing={0.5}
      sx={{ alignItems: "center", minWidth: 0 }}
    >
      {keys.slice(0, 2).map((key) => {
        const label = `${key}: ${record.attributes[key]}`;
        return (
          <Tooltip key={key} title={label}>
            <Chip
              size="small"
              variant="outlined"
              label={label}
              aria-label={label}
              sx={{ minWidth: 0, maxWidth: 120 }}
            />
          </Tooltip>
        );
      })}
      {keys.length > 2 && (
        <Button
          size="small"
          aria-label={`Show ${keys.length - 2} more attributes`}
          onClick={() => open(record)}
          sx={{ minWidth: 32, flexShrink: 0 }}
        >
          +{keys.length - 2}
        </Button>
      )}
    </Stack>
  );
}
