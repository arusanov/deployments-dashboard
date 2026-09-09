import type { ReactNode } from "react";
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

interface Props {
  title: string;
  close: () => void;
  children: ReactNode;
  actions?: ReactNode;
}

export function DetailDrawer({ title, close, children, actions }: Props) {
  const theme = useTheme();

  const mobile = useMediaQuery(theme.breakpoints.down("sm"));

  return (
    <Dialog
      open
      onClose={close}
      fullScreen={mobile}
      maxWidth={false}
      aria-labelledby="detail-title"
      slotProps={{
        paper: {
          sx: {
            m: 0,
            ml: "auto",
            height: "100%",
            maxHeight: "100%",
            width: mobile ? "100%" : 620,
            borderRadius: 0,
          },
        },
      }}
    >
      <DialogTitle
        id="detail-title"
        sx={{ display: "flex", alignItems: "center", gap: 2 }}
      >
        <Box sx={{ flex: 1, overflowWrap: "anywhere" }}>{title}</Box>
        <IconButton aria-label="Close details" onClick={close}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>{children}</DialogContent>
      {actions}
    </Dialog>
  );
}
