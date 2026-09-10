"use client";
import {
  Alert,
  Button,
  DialogActions,
  Divider,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { deploymentRules } from "@/config";
import type { Deployment } from "@/api/client";
import { RetryAlert } from "@/components/retry-alert";
import { DetailDrawer } from "@/components/detail-drawer";
import { useDeploymentDetail } from "./hooks/use-deployment-detail";
import { useAttributeDraft } from "./hooks/use-attribute-draft";
import { DeploymentMetadata } from "./details/metadata";
import { AttributeList } from "./details/attribute-list";
import { AttributeEditor } from "./details/attribute-editor";
import type { Save } from "./mutations/types";

interface Props {
  id: string;
  cached?: Deployment;
  close: () => void;
  save: Save;
  pending: boolean;
}

export default function Detail({ id, cached, close, save, pending }: Props) {
  const { detail, record } = useDeploymentDetail(id, cached);

  const editor = useAttributeDraft(id, save);

  const { draft } = editor;

  return (
    <DetailDrawer
      title={
        record?.attributes.name?.length
          ? record.attributes.name
          : "Deployment details"
      }
      close={close}
      actions={
        draft && (
          <DialogActions>
            <Button disabled={pending} onClick={editor.cancel}>
              Cancel
            </Button>
            <Button
              variant="contained"
              disabled={pending || Boolean(record?.deleted_at)}
              onClick={() => {
                void editor.submit();
              }}
            >
              {pending ? "Saving…" : "Save attributes"}
            </Button>
          </DialogActions>
        )
      }
    >
      {detail.isError && (
        <RetryAlert
          severity="warning"
          onRetry={() => {
            void detail.refetch();
          }}
        >
          Could not load current details.{" "}
          {record
            ? "Showing saved data."
            : "The deployment may be unavailable or expired."}
        </RetryAlert>
      )}
      {!record && detail.isPending && (
        <Stack spacing={2}>
          {[1, 2, 3, 4].map((n) => (
            <Skeleton key={n} height={60} />
          ))}
        </Stack>
      )}
      {record && (
        <Stack spacing={3}>
          {record.deleted_at && (
            <Alert severity="info">
              Deleted {new Date(record.deleted_at).toLocaleString()}. Read only;
              recoverable for {deploymentRules.recoveryDays} days after
              deletion.
              <Button
                disabled={pending}
                onClick={() => {
                  void save({ record, action: "restore" });
                }}
              >
                Restore deployment
              </Button>
            </Alert>
          )}
          <DeploymentMetadata record={record} />
          <Divider />
          <Stack
            direction="row"
            sx={{ alignItems: "center", justifyContent: "space-between" }}
          >
            <Typography variant="h6" component="h3">
              Attributes
            </Typography>
            {!draft && !record.deleted_at && (
              <Button
                onClick={() => {
                  editor.begin(record);
                }}
              >
                Edit attributes
              </Button>
            )}
          </Stack>
          {draft ? (
            <AttributeEditor
              rows={draft.rows}
              changed={record.revision !== draft.base.revision}
              error={editor.error}
              validation={editor.validation}
              pending={pending || Boolean(record.deleted_at)}
              change={editor.change}
              remove={editor.remove}
              add={editor.add}
            />
          ) : (
            <AttributeList record={record} />
          )}
        </Stack>
      )}
    </DetailDrawer>
  );
}
