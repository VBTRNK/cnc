import { useEffect, useRef, type ReactNode } from "react";
import { t } from "./text.ts";

interface SheetProps {
  label: string;
  /** Called on Escape or a tap outside, unless the sheet blocks. */
  onClose?: () => void;
  /** A blocking card can't be dismissed: the player must choose. */
  blocking?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A modal sheet on the native <dialog>: the page behind it is inert, focus stays inside
 * while it is open and returns to the control that opened it. Mounted means open.
 */
export function Sheet({ label, onClose, blocking = false, className = "", children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={`sheet ${blocking ? "sheet-blocking" : ""} ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        if (!blocking) onClose?.();
      }}
      onClose={() => {
        // A browser may close a dialog despite preventDefault (a repeated Escape). A
        // blocking card reopens: its choice is saved and still has to be made.
        const dialog = ref.current;
        if (blocking && dialog?.isConnected && !dialog.open) dialog.showModal();
      }}
      onClick={(e) => {
        if (!blocking && e.target === ref.current) onClose?.();
      }}
    >
      <div className="sheet-body">
        {!blocking && onClose && (
          <button type="button" className="icon-button sheet-close" aria-label={t("close")} onClick={onClose}>
            ×
          </button>
        )}
        {children}
      </div>
    </dialog>
  );
}
