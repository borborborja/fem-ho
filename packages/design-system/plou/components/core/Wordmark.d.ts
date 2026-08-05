export interface WordmarkProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Cap height in px. 24 desktop sidebar, 21-22 mobile header. Default 24. */
  size?: number;
  /** gradient = clipped brand gradient (themed surfaces) · white = over the radar map · ink = flat. */
  tone?: 'gradient' | 'white' | 'ink';
  /** Current place name shown beside the wordmark, e.g. "Navata". */
  place?: string;
}

export declare function Wordmark(props: WordmarkProps): JSX.Element;
