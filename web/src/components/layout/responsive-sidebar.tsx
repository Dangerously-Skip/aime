"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useAppStore } from "@/stores/app-store";

/**
 * Below this the sidebar stops being docked.
 *
 * It was a fixed 250px at every width, so at 900px the Browser surface was
 * left ~280px — too narrow to read a page in. 1100 is where a docked sidebar
 * starts costing the content more than it gives.
 */
export const NARROW_WINDOW_QUERY = "(max-width: 1099px)";

/**
 * The user's docked choice, saved while a narrow window has collapsed it.
 *
 * Collapsing writes `sidebarVisible: false` to the persisted app store, and
 * that is the app's decision, not the user's — without this, quitting while
 * the window is narrow would make the collapse permanent. Saved on the way in,
 * restored (and cleared) on the way out, including on the next launch.
 */
const DOCKED_PREF_KEY = "aime:sidebar-docked";

function readDockedPref(): boolean | null {
  try {
    const v = window.localStorage.getItem(DOCKED_PREF_KEY);
    return v === null ? null : v === "true";
  } catch {
    return null;
  }
}

function writeDockedPref(value: boolean | null) {
  try {
    if (value === null) window.localStorage.removeItem(DOCKED_PREF_KEY);
    else window.localStorage.setItem(DOCKED_PREF_KEY, String(value));
  } catch {
    // Storage unavailable: the collapse still works, only the restore is lost.
  }
}

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(NARROW_WINDOW_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function isNarrowNow(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(NARROW_WINDOW_QUERY).matches;
}

export function useIsNarrowWindow(): boolean {
  return useSyncExternalStore(subscribe, isNarrowNow, () => false);
}

/**
 * Collapse the sidebar when the window becomes narrow; put back the user's own
 * choice when it widens.
 *
 * While narrow, `sidebarVisible` means "the overlay is open", so the existing
 * toggle opens and closes it with no changes of its own. The user's docked
 * choice is never overridden: hide it on a wide window and it stays hidden
 * after a trip through narrow, whatever was done with the overlay meanwhile.
 */
export function useResponsiveSidebar(): boolean {
  const narrow = useIsNarrowWindow();

  useEffect(() => {
    const { sidebarVisible, setSidebarVisible } = useAppStore.getState();
    if (narrow) {
      if (readDockedPref() === null) writeDockedPref(sidebarVisible);
      if (sidebarVisible) setSidebarVisible(false);
    } else {
      const pref = readDockedPref();
      if (pref === null) return;
      writeDockedPref(null);
      if (pref !== sidebarVisible) setSidebarVisible(pref);
    }
  }, [narrow]);

  return narrow;
}

/**
 * The sidebar's container: docked in a wide window, an overlay in a narrow one.
 *
 * The sidebar stays MOUNTED in every state. It owns the Settings dialog, so
 * unmounting it while collapsed would make ⌘, and every `openSettings(...)`
 * deep link silently do nothing.
 */
export function SidebarFrame({
  narrow,
  open,
  onClose,
  children,
}: {
  narrow: boolean;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!narrow || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [narrow, open, onClose]);

  if (!narrow) {
    return (
      <div
        data-sidebar-mode="docked"
        className={`h-full shrink-0 transition-all duration-200 ${open ? "w-[250px]" : "w-0"} overflow-hidden`}
      >
        {children}
      </div>
    );
  }

  return (
    <>
      {open && (
        <div
          data-testid="sidebar-backdrop"
          aria-hidden
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/30"
        />
      )}
      <div
        data-sidebar-mode="overlay"
        aria-hidden={!open}
        className={`fixed inset-y-0 left-0 z-50 w-[250px] shadow-xl transition-transform duration-200 ${
          open ? "translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        {children}
      </div>
    </>
  );
}
