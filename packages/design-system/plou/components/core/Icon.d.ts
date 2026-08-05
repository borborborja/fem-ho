export type PlouIconName =
  | 'radar' | 'forecast' | 'bell' | 'settings'
  | 'crosshair' | 'search' | 'sun' | 'layers' | 'play' | 'pause';

export interface IconProps {
  /** Which glyph from the Plou set. */
  name: PlouIconName;
  /** Square size in px. 20 in controls, 30-42 for feature glyphs. Default 20. */
  size?: number;
  /** Overrides the automatic stroke width (1.8 under 30px, 1.6 at/above). */
  strokeWidth?: number;
  /** Stroke (or fill, for play/pause). Default currentColor. */
  color?: string;
  style?: React.CSSProperties;
}

export declare function Icon(props: IconProps): JSX.Element;
export declare const PLOU_ICONS: Record<string, JSX.Element>;
