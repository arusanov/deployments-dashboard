import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { intendedResult } from "./write-store";
import type { Review, Write } from "./types";

interface Props {
  review?: Review;
  pending: boolean;
  dismissReview: () => void;
  reconcile: (write: Write, message: string) => Promise<void>;
  retryReview: () => Promise<void>;
  acceptReview: () => void;
}

export function WriteFeedback({
  review,
  pending,
  dismissReview,
  reconcile,
  retryReview,
  acceptReview,
}: Props) {
  const current = review?.current;
  const canRetry =
    current &&
    (review.write.action === "restore"
      ? Boolean(current.deleted_at)
      : !current.deleted_at);

  return (
    <>
      <Dialog
        open={Boolean(review)}
        onClose={() => {
          dismissReview();
        }}
        fullWidth
        maxWidth="sm"
        aria-labelledby="review-title"
      >
        <DialogTitle id="review-title">
          Review{" "}
          {review?.write.action === "patch"
            ? "unsaved changes"
            : review?.write.action}
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {review?.message}
          </Alert>
          {current && (
            <Typography sx={{ mb: 2 }}>
              Current revision {current.revision} ·{" "}
              {current.deleted_at ? "Deleted — read only" : "Active"}
            </Typography>
          )}
          <Stack spacing={2}>
            {Object.entries(review?.write.attributes ?? {}).map(
              ([key, value]) => (
                <Box key={key} sx={{ overflowWrap: "anywhere" }}>
                  <Typography sx={{ fontWeight: 700 }}>{key}</Typography>
                  <Typography sx={{ whiteSpace: "pre-wrap" }}>
                    Your draft:{" "}
                    {value === null ? "(remove attribute)" : value || "(empty)"}
                  </Typography>
                  <Typography
                    color="text.secondary"
                    sx={{ whiteSpace: "pre-wrap" }}
                  >
                    Current:{" "}
                    {current
                      ? (current.attributes[key] ?? "(absent)")
                      : "(not loaded)"}
                  </Typography>
                </Box>
              ),
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              dismissReview();
            }}
          >
            Continue editing
          </Button>
          {review?.canReconcile && (
            <Button
              disabled={pending}
              onClick={() => {
                void reconcile(
                  review.write,
                  "Review the current state before retrying.",
                );
              }}
            >
              Check current state
            </Button>
          )}
          {current && intendedResult(review.write, current) ? (
            <Button disabled={pending} onClick={acceptReview}>
              Accept current result
            </Button>
          ) : (
            canRetry && (
              <Button
                disabled={pending}
                onClick={() => {
                  void retryReview();
                }}
              >
                Retry against revision {current.revision}
              </Button>
            )
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
