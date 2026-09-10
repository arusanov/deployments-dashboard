import { browsePolicy } from "@/config";
import { debounce, useEventCallback } from "@mui/material/utils";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

export function useSearch(
  committed: string,
  submit: (value: string) => void,
  navigation = committed,
) {
  const [value, setValue] = useState(committed);

  const composing = useRef(false);

  const submitCurrent = useEventCallback((next: string) => submit(next.trim()));
  const delayedSubmit = useMemo(
    () => debounce(submitCurrent, browsePolicy.debounceMs),
    [submitCurrent],
  );

  const [previous, setPrevious] = useState(navigation);

  // Reset during render so a newly selected window never paints the old input.
  // The layout cleanup below cancels its pending submission instead of flushing it.
  if (previous !== navigation) {
    setPrevious(navigation);
    setValue(committed);
  }

  useLayoutEffect(
    () => () => {
      delayedSubmit.clear();
    },
    [navigation, delayedSubmit],
  );
  const commit = (next: string) => {
    delayedSubmit.clear();
    submit(next.trim());
  };

  const change = (next: string) => {
    setValue(next);
    delayedSubmit.clear();

    if (!composing.current) {
      if (next === "") {
        commit(next);
      } else {
        delayedSubmit(next);
      }
    }
  };

  return {
    value,
    change,
    commit: () => {
      if (!composing.current) {
        commit(value);
      }
    },
    compositionStart: () => {
      composing.current = true;
      delayedSubmit.clear();
    },
    compositionEnd: (next: string) => {
      composing.current = false;
      change(next);
    },
    composing,
  };
}
