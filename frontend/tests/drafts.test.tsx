import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useInlineEditing } from "../src/deployments/hooks/use-inline-editing";
import { useAttributeDraft } from "../src/deployments/hooks/use-attribute-draft";
import type { Write } from "../src/deployments/mutations/types";
import { testSession } from "./session";
import { record } from "./fixtures";
import { useWrite } from "../src/deployments/hooks/use-write";
import { api } from "../src/api/client";

it("isolates drafts and write feedback between providers", async () => {
  const firstSession = testSession();
  const secondSession = testSession();
  const base = record();
  const detail = vi.spyOn(api, "detail").mockResolvedValue(base);
  const save = vi.fn();
  const useEditor = () => ({
    draft: useInlineEditing(base, "name", save),
    writes: useWrite(),
  });
  const first = renderHook(useEditor, { wrapper: firstSession.wrapper });
  const second = renderHook(useEditor, { wrapper: secondSession.wrapper });

  act(() => first.result.current.draft.start());
  act(() => first.result.current.draft.change("Private draft"));
  await act(async () => {
    await first.result.current.writes.execute({
      record: base,
      action: "patch",
      attributes: { name: "Private draft" },
      reconcileFirst: true,
    });
  });
  expect(first.result.current.writes.review).toBeDefined();
  expect(second.result.current.draft.draft).toBeUndefined();
  expect(second.result.current.writes.review).toBeUndefined();
  expect(second.result.current.writes.pending).toBe(false);
  detail.mockRestore();
});

it("retains an inline draft and captured revision across virtual unmount and remote refresh", async () => {
  const { wrapper } = testSession();

  const base = record({ deployment_id: crypto.randomUUID() });

  const save = vi.fn().mockResolvedValue(undefined);

  const view = renderHook(() => useInlineEditing(base, "name", save), {
    wrapper,
  });

  act(() => {
    view.result.current.start();
  });
  act(() => {
    view.result.current.change("Unsaved");
  });
  view.unmount();
  const returned = renderHook(
    () => useInlineEditing({ ...base, revision: 2 }, "name", save),
    { wrapper },
  );

  expect(returned.result.current.draft?.value).toBe("Unsaved");
  expect(returned.result.current.draft?.base.revision).toBe(1);
  expect(returned.result.current.focus).toBe(false);
  await act(async () => {
    await returned.result.current.commit();
  });
  await act(async () => {
    await returned.result.current.commit();
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(returned.result.current.draft?.value).toBe("Unsaved");
  act(() => {
    returned.result.current.cancel();
  });
});

it("keeps attribute drafts when a drawer closes or navigates to another record", () => {
  const { wrapper } = testSession();

  const base = record({ deployment_id: crypto.randomUUID() });

  const save = vi.fn();

  const view = renderHook(({ id }) => useAttributeDraft(id, save), {
    initialProps: { id: base.deployment_id },
    wrapper,
  });

  act(() => {
    view.result.current.begin(base);
  });
  act(() => {
    view.result.current.change(0, "value", "Keep me");
  });
  view.rerender({ id: "another" });
  expect(view.result.current.draft).toBeUndefined();
  view.rerender({ id: base.deployment_id });
  expect(view.result.current.draft?.rows[0]?.value).toBe("Keep me");
  act(() => {
    view.result.current.cancel();
  });
});

it("typing in one draft does not render unrelated editors", () => {
  const { wrapper } = testSession();

  const save = vi.fn();

  let unrelatedRenders = 0;

  const first = renderHook(
    () => useInlineEditing(record({ deployment_id: "first" }), "name", save),
    { wrapper },
  );

  renderHook(
    () => {
      unrelatedRenders++;

      return useInlineEditing(
        record({ deployment_id: "second" }),
        "name",
        save,
      );
    },
    { wrapper },
  );
  const before = unrelatedRenders;

  act(() => {
    first.result.current.start();
  });
  act(() => {
    first.result.current.change("typing");
  });
  expect(unrelatedRenders).toBe(before);
});

it("completion from an unmounted editor cannot clear a newer draft", async () => {
  const { wrapper, stores } = testSession();

  const base = record({ deployment_id: crypto.randomUUID() });

  let complete: (() => void) | undefined;

  const save = vi.fn(
    (write: Write) =>
      new Promise<undefined>((resolve) => {
        complete = () => {
          if (write.draft) {
            stores.inline.finish(
              write.draft.key,
              write.draft.version,
              write.draft.submission,
              "saved",
            );
          }
          resolve(undefined);
        };
      }),
  );

  const first = renderHook(() => useInlineEditing(base, "name", save), {
    wrapper,
  });

  act(() => {
    first.result.current.start();
  });
  act(() => {
    first.result.current.change("submitted");
  });
  let request: Promise<void>;

  act(() => {
    request = first.result.current.commit();
  });
  first.unmount();
  const second = renderHook(() => useInlineEditing(base, "name", save), {
    wrapper,
  });

  act(() => {
    second.result.current.change("newer draft");
  });
  await act(async () => {
    complete?.();
    await request;
  });
  expect(second.result.current.draft?.value).toBe("newer draft");
});

it("a remembered review can be reopened after the editor and its feedback unmount", async () => {
  const { wrapper, stores } = testSession();

  const base = record({ deployment_id: crypto.randomUUID() });

  const save = vi.fn((write: Write) => {
    if (write.draft) {
      stores.inline.finish(
        write.draft.key,
        write.draft.version,
        write.draft.submission,
        "unknown",
      );
    }
    return Promise.resolve(undefined);
  });

  const first = renderHook(() => useInlineEditing(base, "name", save), {
    wrapper,
  });

  act(() => {
    first.result.current.start();
  });
  act(() => {
    first.result.current.change("Uncertain");
  });
  await act(async () => {
    await first.result.current.commit();
  });
  first.unmount();
  const returned = renderHook(() => useInlineEditing(base, "name", save), {
    wrapper,
  });

  await act(async () => {
    returned.result.current.review();
    await Promise.resolve();
  });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1]?.[0]).toMatchObject({ reconcileFirst: true });
});

it("reconciles an inline draft reverted to its original value instead of discarding it", async () => {
  const { wrapper } = testSession();
  const base = record();
  const patch = vi
    .spyOn(api, "patch")
    .mockRejectedValue(new Error("Unknown write"));
  const detail = vi
    .spyOn(api, "detail")
    .mockResolvedValue(
      record({ revision: 2, attributes: { name: "Uncertain" } }),
    );
  const view = renderHook(
    () => {
      const writes = useWrite();
      return { writes, edit: useInlineEditing(base, "name", writes.execute) };
    },
    { wrapper },
  );
  act(() => view.result.current.edit.start());
  act(() => view.result.current.edit.change("Uncertain"));
  await act(async () => {
    await view.result.current.edit.commit();
  });
  act(() => view.result.current.writes.dismissReview());
  act(() => view.result.current.edit.change(base.attributes.name ?? ""));
  await act(async () => {
    await view.result.current.edit.commit();
  });
  expect(view.result.current.edit.draft?.value).toBe(base.attributes.name);
  expect(view.result.current.writes.review?.write.attributes).toEqual({
    name: base.attributes.name,
  });
  expect(detail).toHaveBeenCalledTimes(2);
  expect(patch).toHaveBeenCalledTimes(1);
  vi.restoreAllMocks();
});

it("reconciles an attribute draft whose local patch becomes empty after an unknown save", async () => {
  const { wrapper } = testSession();
  const base = record();
  const patch = vi
    .spyOn(api, "patch")
    .mockRejectedValue(new Error("Unknown write"));
  const detail = vi
    .spyOn(api, "detail")
    .mockResolvedValue(
      record({ revision: 2, attributes: { name: "Uncertain" } }),
    );
  const view = renderHook(
    () => {
      const writes = useWrite();
      return {
        writes,
        edit: useAttributeDraft(base.deployment_id, writes.execute),
      };
    },
    { wrapper },
  );
  act(() => view.result.current.edit.begin(base));
  act(() => view.result.current.edit.change(0, "value", "Uncertain"));
  await act(async () => {
    await view.result.current.edit.submit();
  });
  act(() => view.result.current.writes.dismissReview());
  act(() =>
    view.result.current.edit.change(0, "value", base.attributes.name ?? ""),
  );
  await act(async () => {
    await view.result.current.edit.submit();
  });
  expect(view.result.current.edit.draft).toBeDefined();
  expect(view.result.current.writes.review?.write.attributes).toEqual({
    name: base.attributes.name,
  });
  expect(detail).toHaveBeenCalledTimes(2);
  expect(patch).toHaveBeenCalledTimes(1);
  vi.restoreAllMocks();
});
