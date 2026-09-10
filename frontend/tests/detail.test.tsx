import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { queryKeys } from "../src/cache/keys";
import { useDeploymentDetail } from "../src/deployments/hooks/use-deployment-detail";
import { record } from "./fixtures";
import { testSession } from "./session";

it("reuses an inactive retained row immediately and refreshes absent active details independently", async () => {
  const { client, wrapper } = testSession();

  const saved = record();

  client.setQueryData(queryKeys.window({ q: "inactive" }), {
    pages: [
      {
        items: [saved],
        limit: 50,
        next_cursor: null,
        previous_cursor: null,
      },
    ],
    pageParams: [null],
  });
  const read = vi
    .spyOn(api, "detail")
    .mockResolvedValue({ ...saved, revision: 2 });

  const view = renderHook(() => useDeploymentDetail(saved.deployment_id), {
    wrapper,
  });

  expect(view.result.current.record).toEqual(saved);
  await waitFor(() => {
    expect(view.result.current.record?.revision).toBe(2);
  });
  expect(read).toHaveBeenCalledTimes(1);
  view.unmount();
  client.clear();
  read.mockRestore();
});
