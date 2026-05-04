"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState, type ReactNode } from "react";

interface ModalProps {
  trigger: ReactNode;
  title: string;
  description?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Wider modal for forms with denomination grids etc. */
  wide?: boolean;
}

export function Modal({ trigger, title, description, children, wide = false }: ModalProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {/*
        Avoid Dialog.Trigger asChild here: Radix Slot clones React elements, which produces a
        server/client hydration mismatch when the trigger is rendered by an RSC parent
        (Primitive.button.Slot vs Primitive.button.SlotClone). Using a plain div with onClick
        keeps the trigger content unchanged in the DOM and avoids the mismatch.
      */}
      <div onClick={() => setOpen(true)} style={{ display: "contents" }}>
        {trigger}
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 ${
            wide ? "w-[640px]" : "w-[480px]"
          } max-w-[90vw] max-h-[90vh] overflow-auto bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg shadow-2xl p-6`}
        >
          <Dialog.Title className="text-lg font-semibold text-amber-500 mb-1">{title}</Dialog.Title>
          {description && (
            <Dialog.Description className="text-sm text-slate-400 mb-4">{description}</Dialog.Description>
          )}
          <div>{typeof children === "function" ? children(close) : children}</div>
          <Dialog.Close asChild>
            <button
              aria-label="Close"
              className="absolute top-3 right-3 text-slate-500 hover:text-white text-lg leading-none w-7 h-7 rounded hover:bg-white/5 flex items-center justify-center"
            >
              ×
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
