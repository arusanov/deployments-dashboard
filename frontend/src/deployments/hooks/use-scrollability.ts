import { useCallback, useLayoutEffect, useRef, useState } from "react";

// Read the actual viewport after Virtuoso and browser layout measurements.
export function useScrollability() {
  const [scroller, setElement] = useState<HTMLElement | null>(null);
  const [scrollable, setScrollable] = useState<boolean>();
  const attached = useRef<HTMLElement | null>(null);
  const totalHeight = useRef(0);
  const frame = useRef<number | undefined>(undefined);
  const measure = useCallback(() => {
    if (frame.current !== undefined) {
      cancelAnimationFrame(frame.current);
    }
    frame.current = requestAnimationFrame(() => {
      if (!scroller || scroller.clientHeight <= 0) {
        return;
      }
      const headerHeight =
        scroller.querySelector("thead")?.getBoundingClientRect().height ?? 0;
      const rowHeight =
        scroller.querySelector("[data-deployment-id]")?.getBoundingClientRect()
          .height ?? 0;
      // Initial height callbacks can describe only the header/probe layout.
      // Wait for row geometry and for the DOM to reflect Virtuoso's total height.
      if (
        totalHeight.current <= headerHeight ||
        rowHeight <= 0 ||
        scroller.scrollHeight < Math.floor(totalHeight.current)
      ) {
        return;
      }
      setScrollable(scroller.scrollHeight > scroller.clientHeight);
    });
  }, [scroller]);
  const setScroller = useCallback((element: HTMLElement | Window | null) => {
    const next = element instanceof HTMLElement ? element : null;
    if (attached.current !== next) {
      attached.current = next;
      totalHeight.current = 0;
      setScrollable(undefined);
      if (frame.current !== undefined) {
        cancelAnimationFrame(frame.current);
      }
      setElement(next);
    }
  }, []);
  const heightChanged = useCallback(
    (height: number) => {
      totalHeight.current = height;
      measure();
    },
    [measure],
  );

  useLayoutEffect(() => {
    if (!scroller) {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    const table = scroller.querySelector("table");
    if (table) {
      observer.observe(table);
    }
    measure();
    return () => {
      observer.disconnect();
      if (frame.current !== undefined) {
        cancelAnimationFrame(frame.current);
      }
    };
  }, [scroller, measure]);

  return { setScroller, measure, heightChanged, scrollable };
}
