import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ToastHost, useToast } from "../src/components/toast-host";

function Messages() {
  const notify = useToast();
  return (
    <button
      onClick={() =>
        notify({
          id: crypto.randomUUID(),
          message: "Changes saved.",
          severity: "success",
        })
      }
    >
      Save
    </button>
  );
}

afterEach(() => vi.useRealTimers());

it("restarts six-second dismissal for identical messages and ignores click-away", () => {
  vi.useFakeTimers();
  render(
    <ToastHost>
      <Messages />
    </ToastHost>,
  );
  fireEvent.click(screen.getByText("Save"));
  act(() => {
    vi.advanceTimersByTime(4000);
  });
  fireEvent.click(screen.getByText("Save"));
  act(() => {
    vi.advanceTimersByTime(2500);
  });
  fireEvent.click(document.body);
  expect(screen.getByText("Changes saved.")).toBeVisible();
  act(() => {
    vi.advanceTimersByTime(3499);
  });
  expect(screen.getByText("Changes saved.")).toBeVisible();
  act(() => {
    vi.advanceTimersByTime(1001);
  });
  expect(screen.queryByText("Changes saved.")).not.toBeInTheDocument();
});

it("dismisses with the close button without invoking another action", () => {
  render(
    <ToastHost>
      <Messages />
    </ToastHost>,
  );
  fireEvent.click(screen.getByText("Save"));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByText("Changes saved.")).not.toBeInTheDocument();
});
