/**
 * @startingPoint section="Forms" subtitle="Capsule segmented control — the Plou choice pattern" viewport="700x150"
 */
export interface SegmentedOption { value: string; label: string }

export interface SegmentedControlProps {
  /** Plain strings, or {value,label} pairs. 2-4 options; use a Select-style list beyond that. */
  options: Array<string | SegmentedOption>;
  /** Selected value. Uncontrolled fallback is the first option. */
  value?: string;
  onChange?: (value: string) => void;
  /** sm = sidebar (7/8px, 11.5px) · md = desktop · mobile = 9/10px, 12.5px. Default 'md'. */
  size?: 'sm' | 'md' | 'mobile';
  /** Stretch to full width with equal-flex options. */
  block?: boolean;
  style?: React.CSSProperties;
}

export declare function SegmentedControl(props: SegmentedControlProps): JSX.Element;
