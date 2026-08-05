export interface TabBarTab { value: string; label: string; icon?: React.ReactNode }

export interface TabBarProps {
  /** Plou ships four: Radar · Previsión · Alarmas · Ajustes. */
  tabs: TabBarTab[];
  value: string;
  onChange?: (value: string) => void;
  /** Absolutely positioned 22px from each side, 18px from the bottom. Default true. */
  floating?: boolean;
  style?: React.CSSProperties;
}

export declare function TabBar(props: TabBarProps): JSX.Element;
