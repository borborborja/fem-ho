export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** neutral · accent (20% brand wash, for the one tag worth noticing) · glass (over map) · onAlert. */
  tone?: 'neutral' | 'accent' | 'glass' | 'onAlert';
  /** sm = 11px/5-12px padding (mobile) · md = 12px/6-13px (desktop). Default 'md'. */
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

export declare function Tag(props: TagProps): JSX.Element;
