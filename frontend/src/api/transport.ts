import { ApiError, NetworkError, type ValidationIssue } from "./errors";

export async function fetchResponse(request: Request): Promise<Response> {
  let response: Response;

  try {
    response = await globalThis.fetch(request, {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
    });
  } catch (error) {
    throw new NetworkError(error);
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);

    const fields = typeof body === "object" && body !== null ? body : {};

    const code =
      "code" in fields && typeof fields.code === "string"
        ? fields.code
        : "http_error";

    const message =
      "message" in fields && typeof fields.message === "string"
        ? fields.message
        : `The API returned HTTP ${response.status}. Retry when the service is available.`;

    const details =
      "details" in fields && Array.isArray(fields.details)
        ? fields.details.filter((issue: unknown): issue is ValidationIssue => {
            if (typeof issue !== "object" || issue === null) {
              return false;
            }
            return (
              "location" in issue &&
              Array.isArray(issue.location) &&
              issue.location.every(
                (part: unknown) =>
                  typeof part === "string" || typeof part === "number",
              ) &&
              "message" in issue &&
              typeof issue.message === "string" &&
              "type" in issue &&
              typeof issue.type === "string"
            );
          })
        : [];
    throw new ApiError(response.status, code, message, details);
  }

  return response;
}
