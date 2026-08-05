export interface GlassBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** pill = the radar playback / search bar · sheet = a 22px-radius glass panel. Default 'pill'. */
  shape?: 'pill' | 'sheet';
  children?: React.ReactNode;
}

export declare function GlassBar(props: GlassBarProps): JSX.Element;
