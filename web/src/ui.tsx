import { useEffect, useRef, useId, type ReactNode, type MouseEventHandler, type AriaAttributes } from "react";
import { X } from "lucide-react";
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="alert">
      {children}
    </div>
  );
}
export function Button({
  children,
  onClick,
  title,
  disabled = false,
  className = "",
  pressed,
  expanded,
  ariaLabel,
  ariaCurrent,
}: {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  title?: string;
  disabled?: boolean;
  className?: string;
  pressed?: boolean;
  expanded?: boolean;
  ariaLabel?: string;
  ariaCurrent?: AriaAttributes["aria-current"];
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={className}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-label={ariaLabel}
      aria-current={ariaCurrent}
    >
      {children}
    </button>
  );
}
export function Dialog({
  title,
  onClose,
  children,
  hideClose = false,
  closeLabel = "Fechar",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  hideClose?: boolean;
  closeLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      // Restore focus only after the rest of the document is no longer inert.
      if (dialog?.open) dialog.close();
      if (prior?.isConnected) prior.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="orgmap-dialog"
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        {!hideClose && <Button title={closeLabel} ariaLabel={closeLabel} onClick={onClose}>
          <X size={18} />
        </Button>}
      </div>
      {children}
    </dialog>
  );
}
export function Field({
  label,
  name,
  value = "",
  type = "text",
  required = false,
  maxLength,
  children,
}: {
  label: string;
  name: string;
  value?: string;
  type?: string;
  required?: boolean;
  maxLength?: number;
  children?: ReactNode;
}) {
  return (
    <label className="field">
      {label}
      {children ?? (
        <input
          name={name}
          type={type}
          defaultValue={value}
          required={required}
          maxLength={maxLength === undefined ? undefined : maxLength * 2}
          onInput={(event) => {
            const input = event.currentTarget;
            input.setCustomValidity(
              maxLength !== undefined &&
                Array.from(input.value.trim()).length > maxLength
                ? `Use no máximo ${maxLength} caracteres.`
                : required && type === "text" && !input.value.trim()
                  ? "Preencha este campo."
                  : "",
            );
          }}
          autoComplete={
            type === "password"
              ? "current-password"
              : name === "email"
                ? "email"
                : "off"
          }
        />
      )}
    </label>
  );
}
