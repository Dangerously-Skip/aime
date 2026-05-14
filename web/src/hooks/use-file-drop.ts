"use client";

import { useState, useCallback, useEffect, useRef, type DragEvent } from "react";
import { processFiles, type AttachmentFile } from "@/components/shared/attachment-menu";

export function useFileDrop(onFiles: (file: AttachmentFile) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const reset = useCallback(() => {
    dragCounter.current = 0;
    setIsDragging(false);
  }, []);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      reset();
    }
  }, [reset]);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      reset();
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        processFiles(files, onFiles);
      }
    },
    [onFiles, reset]
  );

  // Browsers don't always fire `dragleave` when the drag exits the window —
  // the overlay can get stuck "open". Catch the safety-net events at the
  // document level and force a reset so the UI never wedges behind the
  // drop target.
  useEffect(() => {
    if (typeof window === "undefined") return;

    // True dragleave on the document means the cursor actually left the
    // viewport (relatedTarget is null and coordinates are at the edge).
    const onDocDragLeave = (e: globalThis.DragEvent) => {
      // Firefox/Chrome give clientX === 0 && clientY === 0 (or related null)
      // when the drag pointer leaves the window. Inner element transitions
      // always have a relatedTarget inside <html>.
      if (e.relatedTarget === null && (e.clientX === 0 || e.clientY === 0)) {
        reset();
      }
    };
    const onDocDrop = () => reset();
    const onDocDragEnd = () => reset();
    // Esc cancels the drag.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") reset();
    };

    document.addEventListener("dragleave", onDocDragLeave);
    document.addEventListener("drop", onDocDrop);
    document.addEventListener("dragend", onDocDragEnd);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("dragleave", onDocDragLeave);
      document.removeEventListener("drop", onDocDrop);
      document.removeEventListener("dragend", onDocDragEnd);
      document.removeEventListener("keydown", onKey);
    };
  }, [reset]);

  return {
    isDragging,
    dropZoneProps: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
