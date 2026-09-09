import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSearch } from "../src/deployments/hooks/use-search";

afterEach(() => {
  vi.useRealTimers();
});

it("commits after 300ms, on Enter and clear, and respects composition", () => {
  vi.useFakeTimers();
  const submit = vi.fn();

  const { result } = renderHook(() => useSearch("", submit));

  act(() => {
    result.current.change("a");
  });
  act(() => {
    vi.advanceTimersByTime(200);
    result.current.change("abc");
  });
  act(() => {
    vi.advanceTimersByTime(299);
  });
  expect(submit).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(submit).toHaveBeenLastCalledWith("abc");
  submit.mockClear();
  act(() => {
    result.current.compositionStart();
    result.current.change("日本");
  });
  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(submit).not.toHaveBeenCalled();
  act(() => {
    result.current.compositionEnd("日本語");
  });
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(submit).toHaveBeenLastCalledWith("日本語");
  act(() => {
    result.current.change(" instant ");
  });
  act(() => {
    result.current.commit();
  });
  expect(submit).toHaveBeenLastCalledWith("instant");
  act(() => {
    result.current.change("");
  });
  expect(submit).toHaveBeenLastCalledWith("");
});

it("restores committed navigation state and cancels a pending search on unmount", () => {
  vi.useFakeTimers();
  const submit = vi.fn();

  const view = renderHook(({ committed }) => useSearch(committed, submit), {
    initialProps: { committed: "old" },
  });

  view.rerender({ committed: "linked" });
  expect(view.result.current.value).toBe("linked");
  act(() => {
    view.result.current.change("unsent");
  });
  view.unmount();
  vi.advanceTimersByTime(400);
  expect(submit).not.toHaveBeenCalled();
});

it("cancels pending debounce when committed navigation changes", () => {
  vi.useFakeTimers();
  const submit = vi.fn();

  const view = renderHook(
    ({ committed, navigation }) => useSearch(committed, submit, navigation),
    {
      initialProps: { committed: "old", navigation: "active" },
    },
  );

  act(() => {
    view.result.current.change("stale draft");
  });
  view.rerender({ committed: "linked", navigation: "trash" });
  act(() => {
    vi.advanceTimersByTime(400);
  });
  expect(view.result.current.value).toBe("linked");
  expect(submit).not.toHaveBeenCalled();
  act(() => {
    view.result.current.change("another stale draft");
  });
  view.rerender({ committed: "linked", navigation: "filtered" });
  act(() => {
    vi.advanceTimersByTime(400);
  });
  expect(submit).not.toHaveBeenCalled();
});

it("uses the current callback without restarting the delay and never repeats an immediate commit", () => {
  vi.useFakeTimers();
  const original = vi.fn();
  const current = vi.fn();
  const view = renderHook(({ submit }) => useSearch("", submit), {
    initialProps: { submit: original },
  });

  act(() => view.result.current.change("pending"));
  act(() => {
    vi.advanceTimersByTime(200);
  });
  view.rerender({ submit: current });
  act(() => {
    vi.advanceTimersByTime(100);
  });
  expect(original).not.toHaveBeenCalled();
  expect(current).toHaveBeenCalledExactlyOnceWith("pending");

  act(() => view.result.current.change("enter"));
  act(() => view.result.current.commit());
  act(() => {
    vi.advanceTimersByTime(400);
  });
  expect(current).toHaveBeenCalledTimes(2);

  act(() => view.result.current.change("cancelled"));
  act(() => view.result.current.change(""));
  act(() => {
    vi.advanceTimersByTime(400);
  });
  expect(current).toHaveBeenCalledTimes(3);
  expect(current).toHaveBeenLastCalledWith("");

  act(() => view.result.current.change("composition cancelled"));
  act(() => view.result.current.compositionStart());
  act(() => view.result.current.commit());
  act(() => {
    vi.advanceTimersByTime(400);
  });
  expect(current).toHaveBeenCalledTimes(3);
});
