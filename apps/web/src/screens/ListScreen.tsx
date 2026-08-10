/**
 * La vista de llista senzilla. docs/02 §6.
 *
 * Columna única de 720px màxim, centrada. El títol de la llista, la tasca d'origen com a
 * molla de pa clicable, i els ítems: **casella rodona i text, res més** (P1).
 *
 * El commutador de completats té dues posicions i totes dues es veuen: en línia
 * (ratllats al seu lloc) o en una secció "Completats" al final, plegada amb el recompte.
 * **No s'amaga res: es plega**, que és el mateix criteri que la columna Fet.
 */

import { useState } from 'react';
import { t } from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { ChecklistRow, EmptyState } from '@fem-ho/design-system/femho';
import { api } from '../app/api.js';
import { useApi } from '../app/useApi.js';
import type { Checklist } from '../app/types.js';
import { ErrorBanner } from './BoardScreen.js';

export interface ListScreenProps {
  checklistId: string;
  onOpenTask: (id: string) => void;
  /** Sortir de la llista i tornar al tauler, que és d'on s'hi arriba. */
  onBack: () => void;
}

type View = Checklist & { task_title: string };

export function ListScreen({ checklistId, onOpenTask, onBack }: ListScreenProps) {
  const list = useApi<View>(`/api/v1/checklists/${checklistId}`);
  const [text, setText] = useState('');
  const [completedOpen, setCompletedOpen] = useState(false);
  const [askUnpin, setAskUnpin] = useState(false);

  const data = list.data;
  const items = data?.items ?? [];
  const pending = items.filter((item) => !item.done);
  const done = items.filter((item) => item.done);
  const inline = data?.show_completed_inline !== false;

  const toggle = async (itemId: string, next: boolean): Promise<void> => {
    const result = await api.patch<{ cascade: { checklist_completed: boolean } }>(
      `/api/v1/checklist-items/${itemId}`,
      { done: next },
    );
    // En completar-se una llista pinejada es PROPOSA despinejar-la, no es fa (P1):
    // despinejar-la sola seria decidir per l'usuari.
    if (result.cascade.checklist_completed && data?.pinned === true) setAskUnpin(true);
    list.reload();
  };

  const add = async (): Promise<void> => {
    if (text.trim() === '') return;
    await api.post(`/api/v1/checklists/${checklistId}/items`, { id: uuidv7(), text: text.trim() });
    setText('');
    list.reload();
  };

  const row = (item: { id: string; text: string; done: boolean }, strike: boolean) => (
    <ChecklistRow
      key={item.id}
      text={item.text}
      done={item.done}
      strikeWhenDone={strike}
      toggleLabel={t('checklist.toggleItem', { text: item.text })}
      onToggle={() => void toggle(item.id, !item.done)}
    />
  );

  return (
    <div
      data-testid="list-screen"
      style={{
        maxWidth: 720,
        margin: '0 auto',
        display: 'grid',
        gap: 14,
        opacity: list.revalidating ? 0.6 : 1,
      }}
    >
      {list.error !== undefined ? <ErrorBanner onRetry={list.reload} /> : null}

      <div>
        {/*
          **El camí de tornada al tauler.**

          Hi havia el rastre a la tasca que conté la llista, que obre el modal: serveix per
          anar al pare, no per sortir. El prototip hi posa un "‹ Tornar" i té raó — a una
          llista pinejada s'hi arriba des de la barra, i sense això l'única sortida és el
          botó enrere del navegador, que a mòbil no és a la pantalla.
        */}
        <button
          type="button"
          data-testid="list-back"
          onClick={onBack}
          style={{
            border: 'none',
            background: 'transparent',
            padding: '0 0 6px',
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 13,
            color: 'var(--ink-soft)',
          }}
        >
          {t('nav.backToBoard')}
        </button>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 800, color: 'var(--ink)' }}>
            {data?.name ?? ''}
          </h1>
          {/* El mateix progrés que el menú de la xinxeta, perquè les dues coses coincideixin. */}
          {data === undefined ? null : (
            <span data-testid="list-progress" style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
              {t('nav.pinnedProgress', {
                done: (data.items ?? []).filter((item) => item.done).length,
                total: (data.items ?? []).length,
              })}
            </span>
          )}
        </div>
        {data === undefined ? null : (
          <button
            type="button"
            data-testid="list-breadcrumb"
            onClick={() => onOpenTask(data.task_id)}
            style={{
              border: 'none',
              background: 'transparent',
              padding: '4px 0 0',
              cursor: 'pointer',
              font: 'inherit',
              fontSize: 12,
              color: 'var(--ink-faint)',
            }}
          >
            {data.task_title}
          </button>
        )}
      </div>

      <div
        role="tablist"
        data-testid="list-completed-toggle"
        style={{
          display: 'inline-flex',
          padding: 3,
          borderRadius: 100,
          background: 'var(--ghost-bg)',
          width: 'fit-content',
        }}
      >
        {(
          [
            { key: true, label: t('checklist.completedInline') },
            { key: false, label: t('checklist.completedSection') },
          ] as const
        ).map((option) => (
          <button
            key={String(option.key)}
            type="button"
            role="tab"
            aria-selected={inline === option.key}
            onClick={() => {
              void api
                .patch(`/api/v1/checklists/${checklistId}`, { show_completed_inline: option.key })
                .then(() => {
                  list.reload();
                });
            }}
            style={{
              padding: '6px 14px',
              borderRadius: 100,
              border: 'none',
              cursor: 'pointer',
              font: 'inherit',
              fontSize: 12,
              fontWeight: inline === option.key ? 700 : 500,
              background: inline === option.key ? 'var(--card-bg)' : 'transparent',
              color: inline === option.key ? 'var(--ink)' : 'var(--ink-soft)',
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--card-shadow)',
          padding: 16,
        }}
      >
        {items.length === 0 ? <EmptyState>{t('checklist.empty')}</EmptyState> : null}

        {inline ? items.map((item) => row(item, true)) : pending.map((item) => row(item, false))}

        {!inline && done.length > 0 ? (
          <div style={{ paddingTop: 10 }}>
            <button
              type="button"
              data-testid="list-completed-section"
              onClick={() => setCompletedOpen(!completedOpen)}
              style={{
                border: 'none',
                background: 'transparent',
                padding: '6px 0',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--ink-faint)',
              }}
            >
              {completedOpen ? '▾' : '▸'} {t('checklist.completed')} · {done.length}
            </button>
            {completedOpen ? done.map((item) => row(item, false)) : null}
          </div>
        ) : null}

        <div style={{ paddingTop: 10 }}>
          <input
            className="plou-input"
            data-testid="list-add"
            value={text}
            placeholder={t('checklist.addItem')}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              // `Enter` afegeix i MANTÉ EL FOCUS, per poder-ne encadenar (docs/02 §6).
              void add();
            }}
          />
        </div>
      </div>

      {askUnpin ? (
        <div
          role="status"
          data-testid="list-unpin-prompt"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '10px 14px',
            borderRadius: 12,
            background: 'var(--ghost-bg)',
            fontSize: 12.5,
            color: 'var(--ink-soft)',
          }}
        >
          <span>{t('checklist.done')}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              data-testid="list-unpin"
              onClick={() => {
                void api.delete(`/api/v1/checklists/${checklistId}/pin`).then(() => {
                  setAskUnpin(false);
                  list.reload();
                });
              }}
              style={{
                border: 'none',
                background: 'transparent',
                font: 'inherit',
                fontWeight: 700,
                cursor: 'pointer',
                color: 'var(--ink)',
              }}
            >
              {t('checklist.unpin')}
            </button>
            <button
              type="button"
              onClick={() => setAskUnpin(false)}
              style={{
                border: 'none',
                background: 'transparent',
                font: 'inherit',
                cursor: 'pointer',
                color: 'var(--ink-faint)',
              }}
            >
              {t('checklist.keep')}
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}
