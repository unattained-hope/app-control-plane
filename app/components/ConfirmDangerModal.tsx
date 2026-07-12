import { useEffect, useId, useRef } from "react";
import { Button, Text, Title } from "@tremor/react";

interface ConfirmDangerModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly children: React.ReactNode;
  readonly confirmLabel?: string;
  readonly loading?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Accessible confirmation dialog for irreversible admin actions. */
export function ConfirmDangerModal({
  open,
  title,
  children,
  confirmLabel = "Delete permanently",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDangerModalProps) {
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="apoaap-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="apoaap-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={(e) => e.stopPropagation()}
      >
        <Title id={titleId} className="text-base">
          {title}
        </Title>
        <div id={descId} className="apoaap-modal-body">
          {children}
        </div>
        <div className="apoaap-modal-actions">
          <button
            type="button"
            className="apoaap-btn"
            ref={cancelRef}
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <Button color="red" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
