import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { DeploymentTable } from "../src/deployments/table";
import { testSession } from "./session";
import { record } from "./fixtures";

const resize = new Set<MeasuredObserver>();
class MeasuredObserver {
  targets = new Set<Element>();
  constructor(public callback: () => void) {
    resize.add(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    resize.delete(this);
  }
}

function table() {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", MeasuredObserver);
  const session = testSession();
  const props: ComponentProps<typeof DeploymentTable> = {
    rows: [record()],
    trash: false,
    loading: false,
    unavailable: false,
    fetching: false,
    adjacent: false,
    pending: false,
    state: {
      q: "",
      status: [],
      type: [],
      environment: [],
      sort: "created_at",
      order: "desc",
      view: "active",
      selected: null,
    },
    update: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    windowKey: "measured",
    hasNext: false,
    hasPrevious: true,
    load: vi.fn(),
    restart: vi.fn(),
  };
  const tree = () => (
    <session.wrapper>
      <VirtuosoMockContext.Provider
        value={{ viewportHeight: 720, itemHeight: 72 }}
      >
        <DeploymentTable {...props} />
      </VirtuosoMockContext.Provider>
    </session.wrapper>
  );
  const view = render(tree());
  const scroller = document.querySelector<HTMLElement>(
    '[data-virtuoso-scroller="true"]',
  );
  if (!scroller) {
    throw new Error("Missing scroller");
  }
  const row = scroller.querySelector("[data-deployment-id]");
  if (!row) {
    throw new Error("Missing measured row");
  }
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 500, 72),
  );
  let height = 1200;
  Object.defineProperty(scroller, "clientHeight", {
    configurable: true,
    value: 720,
  });
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    get: () => height,
  });
  return {
    ...view,
    props,
    change: (next: Partial<typeof props>) => {
      Object.assign(props, next);
      view.rerender(tree());
    },
    measure: (next: number) => {
      height = next;
      act(() => {
        for (const observer of resize) {
          if (observer.targets.size === 2) {
            observer.callback();
          }
        }
        vi.advanceTimersToNextFrame();
      });
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resize.clear();
});

it("uses measured dimensions, including later layout changes, without loading adjacent pages", () => {
  const view = table();
  view.measure(1200);
  expect(screen.queryByRole("button", { name: "Restart browsing" })).toBeNull();
  view.measure(720);
  const restart = screen.getByRole("button", { name: "Restart browsing" });
  expect(restart).toBeVisible();
  expect(view.props.load).not.toHaveBeenCalled();
  view.change({ fetching: true });
  expect(restart).toBeDisabled();
  fireEvent.click(restart);
  expect(view.props.restart).not.toHaveBeenCalled();
  view.change({ fetching: false });
  fireEvent.click(restart);
  expect(view.props.restart).toHaveBeenCalledTimes(1);
  view.measure(900);
  expect(screen.queryByRole("button", { name: "Restart browsing" })).toBeNull();
  expect(view.props.load).not.toHaveBeenCalled();
});

it("offers recovery only for successful stranded batches with adjacent cursors", () => {
  const view = table();
  view.measure(720);
  view.change({ rows: [] });
  expect(
    screen.getByRole("button", { name: "Restart browsing" }),
  ).toBeVisible();
  view.change({ hasPrevious: false });
  expect(screen.getByText("No deployments")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Restart browsing" })).toBeNull();
  view.change({ hasNext: true });
  expect(
    screen.getByRole("button", { name: "Restart browsing" }),
  ).toBeVisible();
  view.change({ unavailable: true });
  expect(screen.getByText(/Deployments unavailable/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Restart browsing" })).toBeNull();
  view.change({ unavailable: false, loading: true });
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("button", { name: "Restart browsing" })).toBeNull();
});

it("distinguishes filtered results from an empty active view or Trash", () => {
  const view = table();
  view.change({ rows: [], hasPrevious: false });
  expect(screen.getByText("No deployments")).toBeVisible();
  const state = { ...view.props.state, sort: "name" as const, selected: "id" };
  view.change({ state });
  expect(screen.getByText("No deployments")).toBeVisible();
  view.change({ trash: true });
  expect(screen.getByText("Trash is empty")).toBeVisible();
  for (const filter of [
    { q: "missing" },
    { status: ["active" as const] },
    { type: ["worker" as const] },
    { environment: ["production" as const] },
  ]) {
    for (const trash of [false, true]) {
      view.change({ trash, state: { ...state, ...filter } });
      expect(
        screen.getByText("No deployments match these filters"),
      ).toBeVisible();
    }
  }
});
