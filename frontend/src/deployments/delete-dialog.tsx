import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import { deploymentRules } from "@/config";
import type { Deployment } from "@/api/client";

interface Props {
  record?: Deployment;
  pending: boolean;
  close: () => void;
  confirm: (record: Deployment) => void;
}

export function DeleteDialog({ record, pending, close, confirm }: Props) {
  return (
    <Dialog
      open={Boolean(record)}
      onClose={() => {
        if (!pending) {
          close();
        }
      }}
      aria-labelledby="delete-title"
    >
      <DialogTitle id="delete-title">Move deployment to Trash?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {record?.attributes.name?.length
            ? record.attributes.name
            : record?.deployment_id}{" "}
          will be hidden from active deployments. You can restore it for{" "}
          {deploymentRules.recoveryDays} days.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button disabled={pending} onClick={close}>
          Cancel
        </Button>
        <Button
          color="error"
          variant="contained"
          disabled={pending}
          onClick={() => {
            if (record) {
              confirm(record);
            }
          }}
        >
          Move to Trash
        </Button>
      </DialogActions>
    </Dialog>
  );
}
