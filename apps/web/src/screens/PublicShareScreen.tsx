/**
 * La pàgina d'un enllaç compartit. docs/10 §6, docs/02 §1.
 *
 * És una de les tres pantalles de primer nivell i **no comparteix res amb l'app**: no
 * munta la sessió, no llegeix el token d'usuari i no té barra superior. Qui hi arriba no
 * té compte, i qualsevol cosa que suposi que en té acabaria en una pantalla en blanc.
 *
 * `Referrer-Policy: no-referrer` el posa el servidor a tot `/s/*`: sense això, el token
 * viatjaria a qualsevol lloc que l'usuari obrís des d'aquí.
 */

import { useState } from 'react';
import { t } from '@fem-ho/contracts';
import { ChecklistRow, EmptyState } from '@fem-ho/design-system/femho';
import { request } from '../app/api.js';

interface ShareView {
  permission: 'view' | 'check' | 'comment';
  task: { id: string; title: string; description: string | null } | null;
  checklists: {
    id: string;
    name: string;
    items: { id: string; text: string; done: boolean }[];
  }[];
  comments: { id: string; body: string; guest_name: string | null }[];
}

export function PublicShareScreen({ token }: { token: string }) {
  const [view, setView] = useState<ShareView | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [needs, setNeeds] = useState<{ name: boolean; password: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  const open = async (): Promise<void> => {
    setError(null);
    try {
      const result = await request<ShareView>(`/s/${token}`, {
        method: 'POST',
        body: {
          name: name === '' ? undefined : name,
          password: password === '' ? undefined : password,
        },
      });
      setView(result);
      setNeeds(null);
    } catch (cause) {
      /**
       * El servidor respon `401` amb el motiu, i **la mateixa forma tant si l'enllaç
       * existeix com si no** (docs/10 §4): `unavailable` cobreix el revocat, el caducat,
       * el que ha esgotat visites i el que no ha existit mai. Aquí es tradueixen només
       * els dos que demanen alguna cosa a l'usuari; la resta és un missatge únic, perquè
       * distingir-los diria si l'enllaç va existir.
       */
      const reason = (cause as { problem?: { reason?: string } }).problem?.reason;
      const body = cause instanceof Error ? cause.message : '';
      const wants = reason ?? (body.includes('needs_password') ? 'needs_password' : body.includes('needs_name') ? 'needs_name' : 'unavailable');

      if (wants === 'needs_password' || wants === 'needs_name') {
        setNeeds({ name: wants === 'needs_name', password: wants === 'needs_password' });
        return;
      }
      setError(t('share.wrong'));
    }
  };

  // Primer intent en muntar: la majoria d'enllaços no demanen res.
  useState(() => {
    void open();
  });

  const shell = (children: React.ReactNode) => (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'start center',
        padding: '48px 20px',
        background: 'var(--page-bg)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 620, display: 'grid', gap: 16 }}>{children}</div>
    </main>
  );

  if (view === null) {
    return shell(
      <form
        data-testid="share-gate"
        onSubmit={(event) => {
          event.preventDefault();
          void open();
        }}
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--card-shadow)',
          padding: '32px 28px',
          display: 'grid',
          gap: 12,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: 'var(--ink)' }}>Fem-ho</h1>

        {needs?.name === true ? (
          <input
            className="plou-input"
            data-testid="share-name"
            value={name}
            placeholder={t('share.enterName')}
            onChange={(event) => setName(event.target.value)}
          />
        ) : null}

        {needs?.password === true ? (
          <input
            className="plou-input"
            type="password"
            data-testid="share-password-input"
            value={password}
            placeholder={t('share.enterPassword')}
            onChange={(event) => setPassword(event.target.value)}
          />
        ) : null}

        {error !== null ? (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--danger-text)' }}>
            {error}
          </p>
        ) : null}

        {needs !== null || error !== null ? (
          <button type="submit" className="plou-btn plou-btn-primary" data-testid="share-enter">
            {t('share.enter')}
          </button>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-faint)' }}>{t('state.loading')}</p>
        )}
      </form>,
    );
  }

  const canCheck = view.permission === 'check' || view.permission === 'comment';

  return shell(
    <>
      <article
        data-testid="share-content"
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--card-shadow)',
          padding: '26px 24px',
          display: 'grid',
          gap: 14,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 21, fontWeight: 800, color: 'var(--ink)' }}>
          {view.task?.title ?? ''}
        </h1>
        {view.task?.description === null || view.task?.description === undefined ? null : (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
            {view.task.description}
          </p>
        )}

        {view.checklists.map((checklist) => (
          <section key={checklist.id} style={{ display: 'grid', gap: 3 }}>
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
              {checklist.name}
            </h2>
            {checklist.items.length === 0 ? (
              <EmptyState>{t('checklist.empty')}</EmptyState>
            ) : (
              checklist.items.map((item) => (
                <ChecklistRow
                  key={item.id}
                  text={item.text}
                  done={item.done}
                  toggleLabel={t('checklist.toggleItem', { text: item.text })}
                  onToggle={
                    canCheck
                      ? () => {
                          void request(`/s/${token}/items/${item.id}`, {
                            method: 'POST',
                            body: { done: !item.done },
                          }).then(() => {
                            void open();
                          });
                        }
                      : undefined
                  }
                />
              ))
            )}
          </section>
        ))}
      </article>

      {view.permission === 'comment' ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {view.comments.map((entry) => (
            <div key={entry.id} style={{ fontSize: 12.5, color: 'var(--ink)' }}>
              <strong style={{ fontWeight: 700 }}>{entry.guest_name ?? ''}</strong> {entry.body}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="plou-input"
              data-testid="share-comment"
              value={comment}
              placeholder={t('task.newComment')}
              onChange={(event) => setComment(event.target.value)}
            />
            <button
              type="button"
              className="plou-btn plou-btn-primary"
              onClick={() => {
                if (comment.trim() === '') return;
                void request(`/s/${token}/comments`, {
                  method: 'POST',
                  body: { body: comment.trim() },
                }).then(() => {
                  setComment('');
                  void open();
                });
              }}
            >
              {t('task.send')}
            </button>
          </div>
        </div>
      ) : null}
    </>,
  );
}
