export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Small soft label above the field. Omit for the bare map search box. */
  label?: string;
  /** surface = in dialogs and panels · glass = the search box floating over the radar. */
  tone?: 'surface' | 'glass';
  /** rounded = 14px radius (forms) · pill = fully round (search). Default 'rounded'. */
  shape?: 'rounded' | 'pill';
  style?: React.CSSProperties;
}

export declare function TextField(props: TextFieldProps): JSX.Element;
