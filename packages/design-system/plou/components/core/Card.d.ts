export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** surface = plain themed card · washCool / washWarm = 10-16% brand tint for "highlight" cards · glass = white sheet floating over the map. */
  tone?: 'surface' | 'washCool' | 'washWarm' | 'glass';
  /** Padding + radius pairing: tile 12/18px · tight 16/22px · mobile 18/24px · comfy 22/24px. Default 'comfy'. */
  density?: 'tile' | 'tight' | 'mobile' | 'comfy';
  /** Uppercase warm kicker above the title. */
  kicker?: string;
  title?: React.ReactNode;
  /** Right-aligned faint meta on the title row (e.g. "hace 7 min"). */
  meta?: React.ReactNode;
  children?: React.ReactNode;
}

export declare function Card(props: CardProps): JSX.Element;
