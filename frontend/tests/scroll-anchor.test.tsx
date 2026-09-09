import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useScrollAnchor } from "../src/deployments/hooks/use-scroll-anchor";
import { testSession } from "./session";
import { record } from "./fixtures";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("retains measured anchors internally and cancels queued measurements on unmount", () => {
  vi.useFakeTimers();
  const session = testSession();
  const base = record();
  const rows = [base];
  const scroller = document.createElement("div");
  const row = document.createElement("div");
  row.dataset.deploymentId = base.deployment_id;
  scroller.append(row);
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 12, 500, 72),
  );
  const view = renderHook(
    () => useScrollAnchor(rows, "window", vi.fn(), vi.fn()),
    { wrapper: session.wrapper },
  );
  act(() => {
    view.result.current.setScroller(scroller);
    view.result.current.measure();
    vi.advanceTimersToNextFrame();
  });
  const saved = session.stores.windows.get("window");
  expect(saved?.anchor).toEqual({ id: base.deployment_id, offset: 12 });
  act(() => view.result.current.measure());
  view.unmount();
  act(() => {
    vi.advanceTimersToNextFrame();
  });
  expect(session.stores.windows.get("window")).toBe(saved);
});
