import { Chip, IconButton, TableCell, Tooltip } from "@mui/material";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import RestoreIcon from "@mui/icons-material/Restore";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { Deployment } from "@/api/client";
import type { Save } from "./mutations/types";
import { AttributeTags } from "./attribute-tags";
import InlineEditor from "./inline-editor";

export const columns = [
  { field: "name", label: "Name", width: 240 },
  { field: "actions", label: "Actions", width: 110 },
  { field: "description", label: "Description", width: 280 },
  { field: "tags", label: "Tags", width: 300 },
  { field: "status", label: "Status", width: 120 },
  { field: "type", label: "Type", width: 140 },
  { field: "environment", label: "Environment", width: 145 },
  { field: "version", label: "Version", width: 110 },
  { field: "created_by", label: "Creator", width: 235 },
  { field: "created_at", label: "Created", width: 190 },
] as const;

export function DeploymentCells({
  record,
  pending,
  save,
  remove,
  open,
}: {
  record: Deployment;
  pending: boolean;
  save: Save;
  remove: (record: Deployment) => void;
  open: (record: Deployment) => void;
}) {
  return (
    <>
      <TableCell>
        <InlineEditor
          record={record}
          field="name"
          pending={pending}
          save={save}
        />
      </TableCell>
      <TableCell>
        <Tooltip title="Open details">
          <IconButton
            aria-label="Open details"
            onClick={() => {
              open(record);
            }}
          >
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {record.deleted_at ? (
          <Tooltip title="Restore deployment">
            <IconButton
              disabled={pending}
              aria-label="Restore deployment"
              onClick={() => {
                void save({ record, action: "restore" });
              }}
            >
              <RestoreIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : (
          <Tooltip title="Delete deployment">
            <IconButton
              disabled={pending}
              aria-label="Delete deployment"
              onClick={() => {
                remove(record);
              }}
            >
              <DeleteOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </TableCell>
      <TableCell>
        <InlineEditor
          record={record}
          field="description"
          pending={pending}
          save={save}
        />
      </TableCell>
      <TableCell>
        <AttributeTags record={record} open={open} />
      </TableCell>
      <TableCell>
        <Chip
          size="small"
          variant="outlined"
          color={
            record.status === "active"
              ? "success"
              : record.status === "failed"
                ? "error"
                : "default"
          }
          label={record.status}
        />
      </TableCell>
      <TableCell>{record.type}</TableCell>
      <TableCell>{record.environment}</TableCell>
      <TableCell>{record.version}</TableCell>
      <TableCell>{record.created_by}</TableCell>
      <TableCell>{new Date(record.created_at).toLocaleString()}</TableCell>
    </>
  );
}
