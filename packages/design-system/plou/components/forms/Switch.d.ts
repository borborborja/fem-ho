export interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  /** When set, renders as a full settings row: label left, switch right. */
  label?: string;
  style?: React.CSSProperties;
}

export declare function Switch(props: SwitchProps): JSX.Element;
