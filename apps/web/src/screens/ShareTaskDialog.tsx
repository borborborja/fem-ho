/**
 * Crear un enllaç compartit per a una tasca. docs/10 §6.
 *
 * Uneix `ShareDialog` —que no sap res de xarxa ni de català— amb `POST /shares`. L'URL
 * complet **només arriba en aquesta resposta**: del `token_hmac` no se'n pot treure, i
 * per això el diàleg canvia de mode en comptes de tancar-se.
 */

import { useState } from 'react';
import { t } from '@fem-ho/contracts';
import { ShareDialog, type SharePermission } from '@fem-ho/design-system/femho';
import { api } from '../app/api.js';
import { useMutation } from '../app/useApi.js';

export interface ShareTaskDialogProps {
  taskId: string;
  onClose: () => void;
}

export function ShareTaskDialog({ taskId, onClose }: ShareTaskDialogProps) {
  const [permission, setPermission] = useState<SharePermission>('view');
  const [requireName, setRequireName] = useState(false);
  const [password, setPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [maxViews, setMaxViews] = useState('');
  const [url, setUrl] = useState<string | undefined>(undefined);

  const create = useMutation(async () => {
    const result = await api.post<{ url: string }>('/api/v1/shares', {
      task_id: taskId,
      permission,
      require_name: requireName,
      password: password === '' ? undefined : password,
      // Una data sense hora és tot el dia: es tanca al final, no al principi.
      expires_at: expiresAt === '' ? null : `${expiresAt}T23:59:59.000Z`,
      max_views: maxViews === '' ? null : Number(maxViews),
    });
    setUrl(result.url);
  });

  return (
    <ShareDialog
      open
      labels={{
        title: t('share.title'),
        permission: t('share.permission'),
        permissionView: t('share.permission.view'),
        permissionCheck: t('share.permission.check'),
        permissionComment: t('share.permission.comment'),
        password: t('share.password'),
        passwordPlaceholder: t('share.passwordPlaceholder'),
        expiresAt: t('share.expiresAt'),
        maxViews: t('share.maxViews'),
        requireName: t('share.requireName'),
        onceWarning: t('tokens.onceWarning'),
        create: t('nav.create'),
        copy: t('tokens.copy'),
        close: t('nav.close'),
      }}
      permission={permission}
      onPermissionChange={setPermission}
      requireName={requireName}
      onRequireNameChange={setRequireName}
      password={password}
      onPasswordChange={setPassword}
      expiresAt={expiresAt}
      onExpiresAtChange={setExpiresAt}
      maxViews={maxViews}
      onMaxViewsChange={setMaxViews}
      createdUrl={url}
      busy={create.busy}
      error={create.error?.message}
      onCreate={() => void create.run()}
      onCopy={() => {
        if (url !== undefined) void navigator.clipboard.writeText(url);
      }}
      onClose={onClose}
    />
  );
}
