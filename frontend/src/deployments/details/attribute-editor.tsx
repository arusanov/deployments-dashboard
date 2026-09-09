import { Alert, Button, IconButton, Stack, TextField } from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import { deploymentRules } from "@/config";
import type { ApiError } from "@/api/errors";
import type { AttributeRow } from "../records";

interface Props {
  rows: AttributeRow[];
  changed: boolean;
  error: string;
  validation?: ApiError;
  pending: boolean;
  change: (index: number, field: "key" | "value", value: string) => void;
  remove: (index: number) => void;
  add: () => void;
}

export function AttributeEditor({
  rows,
  changed,
  error,
  validation,
  pending,
  change,
  remove,
  add,
}: Props) {
  const fieldError = (key: string, field: "key" | "value") =>
    validation?.details
      .filter(
        (issue) =>
          issue.location[1] === "attributes" &&
          issue.location[2] === key &&
          (issue.location.includes("[key]")
            ? field === "key"
            : field === "value"),
      )
      .map((issue) => issue.message)
      .join("; ");
  return (
    <Stack spacing={2}>
      {changed && (
        <Alert severity="info">
          This deployment changed while you were editing. Your draft is
          preserved; saving will check for conflicts.
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {rows.map((row, index) => (
        <Stack
          key={row.id}
          spacing={1}
          sx={{ border: 1, borderColor: "divider", p: 2, borderRadius: 1 }}
        >
          <Stack direction="row" spacing={1}>
            <TextField
              fullWidth
              disabled={pending}
              label={`Attribute key ${index + 1}`}
              value={row.key}
              error={Boolean(fieldError(row.key, "key"))}
              helperText={fieldError(row.key, "key")}
              onChange={(event) => {
                change(index, "key", event.target.value);
              }}
            />
            <IconButton
              disabled={pending}
              aria-label={`Remove attribute ${row.key || index + 1}`}
              onClick={() => {
                remove(index);
              }}
            >
              <DeleteOutlineIcon />
            </IconButton>
          </Stack>
          <TextField
            disabled={pending}
            label={`Value for ${row.key || "new attribute"}`}
            multiline
            minRows={1}
            maxRows={6}
            value={row.value}
            error={Boolean(fieldError(row.key, "value"))}
            helperText={fieldError(row.key, "value")}
            onChange={(event) => {
              change(index, "value", event.target.value);
            }}
          />
        </Stack>
      ))}
      <Button
        disabled={pending || rows.length >= deploymentRules.maxAttributes}
        onClick={add}
      >
        Add attribute
      </Button>
    </Stack>
  );
}
