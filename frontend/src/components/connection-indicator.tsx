import { useState } from "react";
import { Box, IconButton, Popover, Tooltip, Typography } from "@mui/material";
import type { SyncStatus } from "@/cache/sync-status";
import { RetryAlert } from "./retry-alert";

const appearance = {
  online: { label: "Online", color: "success.main" },
  updating: { label: "Updating", color: "warning.main" },
  offline: { label: "Offline", color: "text.disabled" },
  error: { label: "Synchronization error", color: "error.main" },
} as const;

export function ConnectionIndicator({
  status,
  retry,
  loading = status.kind === "updating",
}: {
  status: SyncStatus;
  retry?: () => void;
  loading?: boolean;
}) {
  const { label, color } = appearance[status.kind];
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const failed = status.kind === "error" || status.kind === "offline";

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          aria-label="Connection details"
          aria-expanded={Boolean(anchor)}
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{ width: 28, height: 28, p: 0 }}
        >
          <Box
            component="span"
            role="status"
            aria-label={label}
            sx={{ display: "inline-flex" }}
          >
            <Box
              component="span"
              aria-hidden
              sx={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                bgcolor: color,
                animation: loading
                  ? "connection-pulse 1s ease-in-out infinite"
                  : "none",
                "@keyframes connection-pulse": {
                  "0%, 100%": { opacity: 1 },
                  "50%": { opacity: 0.3 },
                },
                "@media (prefers-reduced-motion: reduce)": {
                  animation: "none",
                },
              }}
            />
          </Box>
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box sx={{ p: 1, maxWidth: 480 }}>
          {failed && retry ? (
            <RetryAlert
              severity={status.kind === "error" ? "error" : "warning"}
              label="Retry sync"
              onRetry={() => {
                setAnchor(null);
                retry();
              }}
            >
              {status.message ?? "Connection unavailable. Retry to continue."}
            </RetryAlert>
          ) : (
            <Typography sx={{ p: 1 }}>{status.message ?? label}</Typography>
          )}
        </Box>
      </Popover>
    </>
  );
}
