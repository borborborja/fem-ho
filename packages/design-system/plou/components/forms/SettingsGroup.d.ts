export interface SettingsGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Card heading, e.g. "Unidades", "Aspecto del mapa". */
  title?: string;
  /** Optional explanatory line under the title, e.g. "Este navegador no admite avisos push." */
  note?: string;
  density?: 'mobile' | 'comfy';
  /** One <SettingsRow> per setting — hairlines are inserted between them automatically. */
  children?: React.ReactNode;
}

export interface SettingsRowProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string;
  /** true = label left / control right on one line (units, switches). false = label above (chip groups). */
  inline?: boolean;
  children?: React.ReactNode;
}

export declare function SettingsGroup(props: SettingsGroupProps): JSX.Element;
export declare function SettingsRow(props: SettingsRowProps): JSX.Element;
