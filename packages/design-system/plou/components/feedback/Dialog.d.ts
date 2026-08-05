export interface DialogProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  title?: React.ReactNode;
  /** Max width in px. 420 desktop; pass a large value on mobile so it fills the 20px inset. */
  width?: number;
  /** Backdrop click handler. */
  onClose?: () => void;
  children?: React.ReactNode;
  /** Button row, laid out as equal-flex siblings (Cancelar ghost + primary). */
  footer?: React.ReactNode;
}

export declare function Dialog(props: DialogProps): JSX.Element;
