export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** neutral (in-app chrome) · glass / glassOutlined (over the radar map) · gradient (playback). Default 'neutral'. */
  tone?: 'neutral' | 'glass' | 'glassOutlined' | 'gradient';
  /** Diameter in px. 38 standard, 34 inside the playback bar, 44 for tab targets. Default 38. */
  size?: number;
  /** Accessible label + tooltip. Required — the button has no text. */
  label: string;
  children?: React.ReactNode;
}

export declare function IconButton(props: IconButtonProps): JSX.Element;
