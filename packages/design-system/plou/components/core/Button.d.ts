export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = the brand gradient. Only ONE primary per view. Default 'primary'. */
  variant?: 'primary' | 'ghost' | 'danger' | 'glass' | 'onAlert';
  /** sm 8/14px · md 12/16px (mobile) · lg 12/20px (desktop). Default 'lg'. */
  size?: 'sm' | 'md' | 'lg';
  /** An <Icon /> rendered inline with the label. */
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  /** Stretch to fill its row (width:100% + flex:1). */
  block?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}

export declare function Button(props: ButtonProps): JSX.Element;
