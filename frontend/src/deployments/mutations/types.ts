import type { AttributePatch, Deployment } from "@/api/client";

export interface Write {
  record: Deployment;
  action: "patch" | "delete" | "restore";
  attributes?: AttributePatch;
  desiredAttributes?: Record<string, string>;
  draft?: {
    kind: "inline" | "attributes";
    key: string;
    version: string;
    submission: string;
  };
  reconcileFirst?: boolean;
}

export interface WriteOutcome {
  kind: "saved" | "validation" | "conflict" | "unknown" | "missing";
}

export interface Review {
  id: string;
  write: Write;
  current?: Deployment;
  message: string;
  canReconcile: boolean;
}

export type Save = (write: Write) => Promise<WriteOutcome | undefined>;
