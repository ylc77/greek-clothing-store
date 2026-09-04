"use client";
import { useEffect, useReducer } from "react";
import { emptyLabelQueue, operationLabelQueue } from "@/lib/operation-label-queue";

export function useOperationLabelQueue() {
  const [state, dispatch] = useReducer(operationLabelQueue, undefined, emptyLabelQueue);
  const total = state.entries.reduce((sum, entry) => sum + entry.copies, 0);
  useEffect(() => {
    if (!total) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [total]);
  return { ...state, total, dispatch };
}
