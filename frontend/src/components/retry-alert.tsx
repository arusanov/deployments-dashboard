import { Alert, Button } from "@mui/material";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  onRetry: () => void;
  severity?: "error" | "warning";
  label?: string;
}

export function RetryAlert({
  children,
  onRetry,
  severity = "error",
  label = "Retry",
}: Props) {
  return (
    <Alert
      severity={severity}
      action={<Button onClick={onRetry}>{label}</Button>}
    >
      {children}
    </Alert>
  );
}
