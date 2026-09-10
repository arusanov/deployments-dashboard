import { Box, Button, IconButton, TextField, Tooltip } from "@mui/material";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import type { Deployment } from "@/api/client";
import { useInlineEditing } from "./hooks/use-inline-editing";
import type { Save } from "./mutations/types";

export default function InlineEditor({
  record,
  field,
  pending,
  save,
}: {
  record: Deployment;
  field: "name" | "description";
  pending: boolean;
  save: Save;
}) {
  const edit = useInlineEditing(record, field, save);
  const disabled = pending || Boolean(record.deleted_at);

  const validation =
    edit.draft?.state.phase === "rejected" ? edit.draft.state.error : undefined;
  const error = validation?.details.length
    ? validation.details.map((issue) => issue.message).join("; ")
    : validation?.message;

  if (edit.draft) {
    return (
      <Box
        onBlur={(event) => {
          if (!disabled && !event.currentTarget.contains(event.relatedTarget)) {
            void edit.commit("blur");
          }
        }}
        onKeyDown={(event) => {
          if (
            !disabled &&
            !event.nativeEvent.isComposing &&
            event.key === "Escape"
          ) {
            event.preventDefault();
            edit.cancel();
          }
        }}
      >
        <TextField
          autoFocus={edit.focus}
          fullWidth
          size="small"
          sx={{ "& .MuiInputBase-root": { fontSize: "inherit" } }}
          multiline={field === "description"}
          maxRows={4}
          value={edit.draft.value}
          error={Boolean(error)}
          helperText={error}
          disabled={disabled}
          slotProps={{ htmlInput: { "aria-label": `Edit ${field}` } }}
          onChange={(event) => {
            edit.change(event.target.value);
          }}
          onKeyDown={(event) => {
            if (disabled || event.nativeEvent.isComposing) {
              return;
            }

            if (
              event.key === "Enter" &&
              !(field === "description" && event.shiftKey)
            ) {
              event.preventDefault();
              void edit.commit();
            }
          }}
        />
        <Box
          sx={{
            display: "flex",
            gap: 1,
            "& .MuiButton-root": { py: 0, minHeight: 24 },
          }}
        >
          <Button
            size="small"
            aria-label={`Save ${field}`}
            disabled={disabled}
            onClick={() => {
              void edit.commit();
            }}
          >
            Save
          </Button>
          <Button
            size="small"
            aria-label={`Cancel ${field}`}
            disabled={disabled}
            onClick={edit.cancel}
          >
            Cancel
          </Button>
        </Box>
        {edit.draft.state.phase === "review" && (
          <Button size="small" disabled={disabled} onClick={edit.review}>
            Review {field} draft
          </Button>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <Box
        onDoubleClick={() => {
          if (!record.deleted_at && !pending) {
            edit.start();
          }
        }}
        sx={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {record.attributes[field]?.length
          ? record.attributes[field]
          : field === "name"
            ? "Unnamed deployment"
            : "—"}
      </Box>
      {!record.deleted_at && (
        <Tooltip title={`Edit ${field}`}>
          <IconButton
            size="small"
            aria-label={`Edit ${field}`}
            disabled={pending}
            onClick={edit.start}
          >
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}
