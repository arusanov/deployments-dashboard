import { useCallback, useLayoutEffect, useRef } from "react";
import type { TableVirtuosoHandle } from "react-virtuoso";
import type { Deployment } from "@/api/client";
import { useSessionStores } from "@/cache/session-stores";
import type { ScrollAnchor } from "@/cache/windows";

// Preserve a measured visible row offset across cache return and live page changes.
export function useScrollAnchor(
  rows: Deployment[],
  windowKey: string,
  moved: (delta: number) => void,
  positioning: (active: boolean) => void,
) {
  const store = useSessionStores().windows;
  const virtuosoRef = useRef<TableVirtuosoHandle>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const measurementFrame = useRef<number | undefined>(undefined);
  const cancelPosition = useRef<(() => void) | undefined>(undefined);
  const latest = useRef({ rows, moved, positioning });
  const anchor = useRef<ScrollAnchor | undefined>(store.get(windowKey)?.anchor);
  const initializing = useRef(Boolean(store.get(windowKey)?.anchor));
  const restoring = useRef(false);
  const scrollPending = useRef(false);
  const previousTop = useRef(0);
  const previousRows = useRef(rows);

  useLayoutEffect(() => {
    latest.current = { rows, moved, positioning };
  });
  const capture = useCallback(() => {
    const element = scroller.current;

    if (!element || restoring.current || initializing.current) {
      return;
    }

    const top =
      element.getBoundingClientRect().top +
      (element.querySelector("thead")?.getBoundingClientRect().height ?? 0);
    const visible = [
      ...element.querySelectorAll<HTMLElement>("[data-deployment-id]"),
    ].find((row) => row.getBoundingClientRect().bottom > top);
    const id = visible?.dataset.deploymentId;

    if (!visible || !id) {
      return;
    }

    scrollPending.current = false;
    anchor.current = { id, offset: visible.getBoundingClientRect().top - top };
    store.set(windowKey, {
      lastUsed: store.get(windowKey)?.lastUsed ?? Date.now(),
      anchor: anchor.current,
    });
  }, [store, windowKey]);
  const position = useCallback(
    (index: number, offset: number) => {
      // Programmatic positioning must finish before movement can load a boundary.
      cancelPosition.current?.();
      restoring.current = true;
      latest.current.positioning(true);
      scroller.current?.setAttribute("aria-busy", "true");
      let cancelled = false;
      const frame = requestAnimationFrame(() => {
        virtuosoRef.current?.scrollIntoView({
          index,
          align: "start",
          behavior: "auto",
          calculateViewLocation: ({ locationParams }) => ({
            ...locationParams,
            offset: -offset,
          }),
          done: () => {
            if (cancelled) {
              return;
            }

            previousTop.current = scroller.current?.scrollTop ?? 0;
            restoring.current = false;
            initializing.current = false;
            scroller.current?.removeAttribute("aria-busy");
            capture();
            latest.current.positioning(false);
          },
        });
      });

      cancelPosition.current = () => {
        cancelled = true;
        cancelAnimationFrame(frame);
        restoring.current = false;
        scroller.current?.removeAttribute("aria-busy");
      };
    },
    [capture],
  );
  const measure = useCallback(() => {
    if (initializing.current) {
      return;
    }

    if (measurementFrame.current !== undefined) {
      cancelAnimationFrame(measurementFrame.current);
    }

    measurementFrame.current = requestAnimationFrame(capture);
  }, [capture]);
  const heightChanged = useCallback(
    (height: number) => {
      const saved = anchor.current;

      if (
        height === 0 ||
        !saved ||
        restoring.current ||
        scrollPending.current
      ) {
        return;
      }

      const index = latest.current.rows.findIndex(
        (record) => record.deployment_id === saved.id,
      );

      position(Math.max(0, index), index === -1 ? 0 : saved.offset);
    },
    [position],
  );
  const onScroll = useCallback(() => {
    const top = scroller.current?.scrollTop ?? 0;
    const delta = top - previousTop.current;

    previousTop.current = top;
    if (delta !== 0 && !restoring.current && !initializing.current) {
      scrollPending.current = true;
      latest.current.moved(delta);
      measure();
    }
  }, [measure]);

  useLayoutEffect(() => {
    const old = previousRows.current;

    previousRows.current = rows;
    const saved = anchor.current;

    if (!saved || rows.length === 0 || old === rows) {
      return;
    }

    const ids = new Set(rows.map((record) => record.deployment_id));
    const oldIndex = old.findIndex(
      (record) => record.deployment_id === saved.id,
    );
    // Indexes shift on prepend/eviction. If the anchor disappears, keep the next
    // surviving neighbor (then the previous one) at the same measured offset.
    const survivor = ids.has(saved.id)
      ? saved.id
      : (old.slice(oldIndex + 1).find((record) => ids.has(record.deployment_id))
          ?.deployment_id ??
        old
          .slice(0, Math.max(0, oldIndex))
          .findLast((record) => ids.has(record.deployment_id))?.deployment_id);
    const index = rows.findIndex((record) => record.deployment_id === survivor);

    position(Math.max(0, index), index === -1 ? 0 : saved.offset);
  }, [rows, position]);
  useLayoutEffect(
    () => () => {
      if (measurementFrame.current !== undefined) {
        cancelAnimationFrame(measurementFrame.current);
      }

      cancelPosition.current?.();
      scroller.current?.removeEventListener("scroll", onScroll);
    },
    [onScroll],
  );
  const setScroller = useCallback(
    (element: HTMLElement | Window | null) => {
      scroller.current?.removeEventListener("scroll", onScroll);
      scroller.current = element instanceof HTMLElement ? element : null;
      previousTop.current = scroller.current?.scrollTop ?? 0;
      if (initializing.current) {
        scroller.current?.setAttribute("aria-busy", "true");
      }

      scroller.current?.addEventListener("scroll", onScroll, { passive: true });
    },
    [onScroll],
  );

  return { virtuosoRef, setScroller, measure, heightChanged };
}
