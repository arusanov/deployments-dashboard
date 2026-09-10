import { fetchResponse } from "./transport";
import { ResponseError } from "./errors";
import createClient from "openapi-fetch";
import type { components, paths } from "./generated/schema";

export type Deployment = components["schemas"]["DeploymentOut"];

export type DeploymentPage = components["schemas"]["DeploymentPage"];

export type BrowseQuery = NonNullable<
  paths["/api/deployments"]["get"]["parameters"]["query"]
>;

export type Deletion = Pick<Deployment, "deployment_id" | "revision">;

export type AttributePatch = Record<string, string | null>;

export const apiUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
).replace(/\/$/, "");
const client = createClient<paths>({
  baseUrl: apiUrl,
  cache: "no-store",
  fetch: fetchResponse,
});

function unwrap<T>(result: { data?: T; response: Response }): T {
  if (result.data === undefined) {
    throw new ResponseError("The server returned an empty response.");
  }

  return result.data;
}

// Generated types describe the contract; reject unusable read shapes before caching.
function readRecord(data: Deployment | null | undefined): Deployment {
  const attributes: unknown = data?.attributes;
  if (
    !data ||
    ![
      data.deployment_id,
      data.version,
      data.status,
      data.type,
      data.environment,
      data.created_by,
      data.created_at,
      data.updated_at,
    ].every((value) => typeof value === "string") ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 1 ||
    !(data.deleted_at === null || typeof data.deleted_at === "string") ||
    !attributes ||
    typeof attributes !== "object" ||
    Array.isArray(attributes) ||
    !Object.values(attributes).every((value) => typeof value === "string")
  ) {
    throw new ResponseError(
      "The API returned an unusable deployment. Retry sync.",
    );
  }
  return data;
}

function readPage(data: DeploymentPage | null | undefined): DeploymentPage {
  if (
    !data ||
    !Array.isArray(data.items) ||
    ![data.next_cursor, data.previous_cursor].every(
      (cursor) => cursor === null || typeof cursor === "string",
    )
  ) {
    throw new ResponseError(
      "The API returned an unusable deployment list. Retry sync.",
    );
  }
  for (const record of data.items) {
    readRecord(record);
  }
  return data;
}

const params = (id: string, revision: number) => ({
  path: { deployment_id: id },
  header: { "if-match": `"${revision}"` },
});

export const api = {
  browse: async (query: BrowseQuery, signal?: AbortSignal) =>
    readPage(
      unwrap(
        await client.GET("/api/deployments", { params: { query }, signal }),
      ),
    ),
  detail: async (id: string, signal?: AbortSignal) =>
    readRecord(
      unwrap(
        await client.GET("/api/deployments/{deployment_id}", {
          params: {
            path: { deployment_id: id },
            query: { include_deleted: true },
          },
          signal,
        }),
      ),
    ),
  patch: async (id: string, revision: number, attributes: AttributePatch) =>
    acknowledged(
      id,
      revision,
      await client.PATCH("/api/deployments/{deployment_id}", {
        params: params(id, revision),
        body: { attributes },
      }),
    ),
  restore: async (id: string, revision: number) =>
    acknowledged(
      id,
      revision,
      await client.POST("/api/deployments/{deployment_id}/restore", {
        params: params(id, revision),
      }),
    ),
  delete: async (id: string, revision: number): Promise<Deletion> => {
    const result = await client.DELETE("/api/deployments/{deployment_id}", {
      params: params(id, revision),
    });

    const etag = result.response.headers.get("etag");

    if (
      !etag ||
      !/^"[1-9]\d*"$/.test(etag) ||
      Number(etag.slice(1, -1)) !== revision + 1
    ) {
      throw new ResponseError(
        "Missing deletion revision. Reconcile before retrying.",
      );
    }

    return { deployment_id: id, revision: Number(etag.slice(1, -1)) };
  },
};

function acknowledged(
  id: string,
  revision: number,
  result: { data?: Deployment; response: Response },
) {
  const data = readRecord(unwrap(result));
  if (data.deployment_id !== id || data.revision !== revision + 1) {
    throw new ResponseError(
      "Unusable write acknowledgement. Reconcile before retrying.",
    );
  }
  return data;
}
