export interface ChoiceChip { value: string; label: string }

export interface ChoiceChipsProps {
  /** Strings or {value,label}. Use this rather than SegmentedControl above 4 options. */
  options: Array<string | ChoiceChip>;
  value?: string;
  onChange?: (value: string) => void;
  /** sm = dense unit rows · md = standalone groups. Default 'md'. */
  size?: 'sm' | 'md';
  style?: React.CSSProperties;
}

export declare function ChoiceChips(props: ChoiceChipsProps): JSX.Element;
