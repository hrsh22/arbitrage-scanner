"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseTransientStateOptions {
  durationMs: number;
  initialValue?: boolean;
}

interface UseTransientStateResult {
  value: boolean;
  activate: () => void;
  deactivate: () => void;
}

export function useTransientState({
  durationMs,
  initialValue = false,
}: UseTransientStateOptions): UseTransientStateResult {
  const [value, setValue] = useState(initialValue);
  const timeoutRef = useRef<number | null>(null);

  const deactivate = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    setValue(false);
  }, []);

  const activate = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    setValue(true);
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setValue(false);
    }, durationMs);
  }, [durationMs]);

  useEffect(() => deactivate, [deactivate]);

  return {
    value,
    activate,
    deactivate,
  };
}
