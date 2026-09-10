import type { components } from "./generated/schema";

export type ValidationIssue = components["schemas"]["ValidationIssue"];

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: ValidationIssue[] = [],
  ) {
    super(message);
  }
}

export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("Could not reach the API. Check your connection and retry.", {
      cause,
    });
  }
}

export class ResponseError extends Error {}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
