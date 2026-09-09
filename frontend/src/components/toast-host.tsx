import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Alert, Snackbar, type AlertColor } from "@mui/material";

interface Notice {
  id: string;
  message: string;
  severity: AlertColor;
}

export type Notify = (notice: Notice) => void;

const ToastContext = createContext<Notify | null>(null);

export function ToastHost({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice>();
  const notify = useCallback((next: Notice) => setNotice(next), []);
  // A new notice remounts Snackbar to restart its timer; an old timeout must not
  // dismiss that replacement, even when both notices have identical text.
  const dismiss = () => {
    if (notice) {
      setNotice((current) => (current?.id === notice.id ? undefined : current));
    }
  };

  return (
    <ToastContext value={notify}>
      {children}
      <Snackbar
        key={notice?.id}
        open={Boolean(notice)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        autoHideDuration={6000}
        onClose={(_, reason) => {
          if (reason !== "clickaway") {
            dismiss();
          }
        }}
      >
        <Alert
          severity={notice?.severity}
          onClose={dismiss}
          sx={{ maxWidth: 560 }}
        >
          {notice?.message}
        </Alert>
      </Snackbar>
    </ToastContext>
  );
}

export function useToast() {
  const notify = useContext(ToastContext);
  if (!notify) {
    throw new Error("ToastHost is required.");
  }
  return notify;
}
