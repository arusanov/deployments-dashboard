import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useScrollability } from "../src/deployments/hooks/use-scrollability";

function geometry() {
  const scroller = document.createElement("div");
  const table = document.createElement("table");
  const header = table.createTHead();
  const row = table.createTBody().insertRow();
  row.dataset.deploymentId = "measured";
  scroller.append(table);
  let height = 720;
  Object.defineProperties(scroller, {
    clientHeight: { value: 720 },
    scrollHeight: { get: () => height },
  });
  vi.spyOn(header, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 500, 48),
  );
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 48, 500, 72),
  );
  return { scroller, height: (next: number) => (height = next) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("waits for row-bearing virtual height and its painted layout", () => {
  vi.useFakeTimers();
  const element = geometry();
  const view = renderHook(useScrollability);
  act(() => view.result.current.setScroller(element.scroller));
  act(() => {
    vi.advanceTimersToNextFrame();
  });
  expect(view.result.current.scrollable).toBeUndefined();
  for (const height of [0, 48, 3600]) {
    act(() => {
      view.result.current.heightChanged(height);
      vi.advanceTimersToNextFrame();
    });
    expect(view.result.current.scrollable).toBeUndefined();
  }
  element.height(3600);
  act(() => {
    view.result.current.measure();
    vi.advanceTimersToNextFrame();
  });
  expect(view.result.current.scrollable).toBe(true);
  element.height(720);
  act(() => {
    view.result.current.heightChanged(120);
    vi.advanceTimersToNextFrame();
  });
  expect(view.result.current.scrollable).toBe(false);
});

it("discards measurements when the scroller is replaced or unmounted", () => {
  vi.useFakeTimers();
  const first = geometry();
  const second = geometry();
  const view = renderHook(useScrollability);
  act(() => view.result.current.setScroller(first.scroller));
  act(() => {
    view.result.current.heightChanged(120);
    vi.advanceTimersToNextFrame();
  });
  expect(view.result.current.scrollable).toBe(false);
  act(() => {
    view.result.current.measure();
    view.result.current.setScroller(second.scroller);
  });
  act(() => {
    vi.advanceTimersToNextFrame();
  });
  expect(view.result.current.scrollable).toBeUndefined();
  act(() => view.result.current.heightChanged(120));
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
