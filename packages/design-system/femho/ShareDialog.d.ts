import type { HTMLAttributes } from 'react';

export type SharePermission = 'view' | 'check' | 'comment';

export interface ShareDialogLabels {
  title: string;
  permission: string;
  permissionView: string;
  permissionCheck: string;
  permissionComment: string;
  password: string;
  passwordPlaceholder: string;
  expiresAt: string;
  maxViews: string;
  requireName: string;
  onceWarning: string;
  create: string;
  copy: string;
  close: string;
}

export interface ShareDialogProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onCopy'> {
  open: boolean;
  labels: ShareDialogLabels;
  permission?: SharePermission | undefined;
  onPermissionChange?: (value: SharePermission) => void | undefined;
  requireName?: boolean | undefined;
  onRequireNameChange?: (value: boolean) => void | undefined;
  password?: string | undefined;
  onPasswordChange?: (value: string) => void | undefined;
  expiresAt?: string | undefined;
  onExpiresAtChange?: (value: string) => void | undefined;
  maxViews?: string | undefined;
  onMaxViewsChange?: (value: string) => void | undefined;
  /** Un cop creat, l'URL sencer. Es mostra UN SOL COP. */
  createdUrl?: string | undefined;
  onCreate?: () => void | undefined;
  onCopy?: () => void | undefined;
  onClose?: () => void | undefined;
  busy?: boolean | undefined;
  error?: string | undefined;
}

export declare function ShareDialog(props: ShareDialogProps): JSX.Element | null;
