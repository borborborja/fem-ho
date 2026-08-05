export interface SliderProps {
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  onChange?: (value: number) => void;
  /** Small soft label above the track, e.g. "Radio de vigilancia". */
  label?: string;
  /** Live value appended after the label, e.g. "20 km" or "420 ms". */
  valueLabel?: string;
  style?: React.CSSProperties;
}

export declare function Slider(props: SliderProps): JSX.Element;
