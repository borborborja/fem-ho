export interface NavItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** A 19px <Icon />. */
  icon?: React.ReactNode;
  active?: boolean;
  children?: React.ReactNode;
}

export declare function NavItem(props: NavItemProps): JSX.Element;
