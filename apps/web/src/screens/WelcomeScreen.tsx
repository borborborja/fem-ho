/**
 * La primera pregunta: com reparteixes la feina.
 *
 * **Per què es pregunta i no es dedueix.** Fem-ho posa els àmbits a la barra com el primer
 * eix de navegació, i per a molta gent és exactament el que vol. Per a qui fa servir l'eina
 * per a una sola cosa és una barra amb un sol xip que no fa res. No hi ha cap senyal que ho
 * distingeixi el primer dia —tothom comença amb un àmbit—, o sigui que endevinar-ho voldria
 * dir encertar-ho la meitat de les vegades.
 *
 * **Per què abans de veure res.** Triar-ho aquí costa un clic; descobrir-ho després vol dir
 * haver fet servir una barra que no encaixa, sospitar que l'app no serveix, i trobar
 * l'ajust. La primera impressió d'una eina és quina forma té, i aquesta pantalla la
 * pregunta en comptes d'imposar-la.
 *
 * **Per què no es pot saltar.** No triar és exactament el cas que això elimina. La sortida
 * no és un botó de «després»: és que **cap de les dues opcions és irreversible** i tots dos
 * camins ho diuen a la mateixa pantalla.
 *
 * Només surt a qui no ho ha dit mai **i** quan hi ha res a triar (`app/scope-mode.ts`): si
 * qui allotja la instància ja ho ha decidit, preguntar-ho seria teatre.
 */

import { useState } from 'react';
import { t } from '@fem-ho/contracts';
import { useSession } from '../app/session.js';
import type { ScopeMode } from '../app/scope-mode.js';

/**
 * El dibuix de la barra de cada opció. Es veu abans de llegir res, que és la gràcia.
 *
 * Tres menes de pastilla i no una de sola amb un booleà: **una pastilla d'àmbit encès va
 * amb el color de l'àmbit i text clar a sobre; la pestanya triada va amb el fons de la
 * targeta i text fosc.** Amb un sol `filled` totes dues acabaven amb `--on-brand`, i la
 * pestanya «Tasques» sortia blanca sobre blanc: un dibuix que ha d'explicar la barra amb
 * una peça il·legible explica el contrari del que vol.
 */
function BarPreview({ mode }: { mode: ScopeMode }) {
  const pill = (label: string, look: 'ghost' | 'scope' | 'tab') => (
    <span
      key={label}
      style={{
        padding: '3px 9px',
        borderRadius: 100,
        fontSize: 9.5,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        background:
          look === 'scope'
            ? 'var(--plou-blue)'
            : look === 'tab'
              ? 'var(--card-bg)'
              : 'var(--ghost-bg)',
        color:
          look === 'scope' ? 'var(--on-brand)' : look === 'tab' ? 'var(--ink)' : 'var(--ink-soft)',
      }}
    >
      {label}
    </span>
  );

  return (
    <div
      aria-hidden="true"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '9px 10px',
        borderRadius: 12,
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        overflow: 'hidden',
      }}
    >
      {/* `nowrap`: en una caixa estreta el nom es partia en «Fem-» i «ho». */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 900,
          color: 'var(--ink-faint)',
          whiteSpace: 'nowrap',
        }}
      >
        Fem-ho
      </span>
      {mode === 'single' ? (
        <span
          style={{
            padding: '3px 8px',
            borderRadius: 8,
            fontSize: 9.5,
            fontWeight: 700,
            border: '1px solid var(--card-border)',
            color: 'var(--ink)',
            whiteSpace: 'nowrap',
          }}
        >
          {t('welcome.preview.scope')} ▾
        </span>
      ) : null}
      <span
        style={{
          display: 'inline-flex',
          gap: 2,
          padding: 2,
          borderRadius: 100,
          background: 'var(--ghost-bg)',
        }}
      >
        {pill(t('nav.calendar'), 'ghost')}
        {pill(t('nav.tasks'), 'tab')}
      </span>
      {/*
        **Dues pastilles i no tres.** Amb tres, l'última quedava tallada per la meitat d'una
        paraula, i un text tallat es llegeix com un error i no com «això continua». El
        dibuix ha de dir què hi ha a la barra, i amb dues ja ho diu; els tres exemples els
        dona el text de sota, que sí que hi cap.
      */}
      {mode === 'multi'
        ? [pill(t('welcome.preview.personal'), 'scope'), pill(t('welcome.preview.work'), 'ghost')]
        : [
            pill(t('welcome.preview.projectA'), 'ghost'),
            pill(t('welcome.preview.projectB'), 'ghost'),
          ]}
    </div>
  );
}

export function WelcomeScreen() {
  const { updateSettings } = useSession();
  const [saving, setSaving] = useState<ScopeMode | null>(null);

  const choose = (mode: ScopeMode): void => {
    setSaving(mode);
    void updateSettings({ scope_mode: mode }).catch(() => setSaving(null));
  };

  const card = (mode: ScopeMode, title: string, body: string) => (
    <button
      type="button"
      data-testid={`welcome-${mode}`}
      disabled={saving !== null}
      onClick={() => choose(mode)}
      style={{
        display: 'grid',
        gap: 12,
        textAlign: 'left',
        padding: 20,
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--card-border)',
        background: 'var(--card-bg)',
        boxShadow: 'var(--card-shadow)',
        cursor: saving === null ? 'pointer' : 'default',
        opacity: saving !== null && saving !== mode ? 0.5 : 1,
        font: 'inherit',
        color: 'var(--ink)',
      }}
    >
      <BarPreview mode={mode} />
      <span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span>
      <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.55 }}>{body}</span>
    </button>
  );

  return (
    <main
      data-testid="welcome-screen"
      style={{
        minHeight: '100vh',
        background: 'var(--page-bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 760, display: 'grid', gap: 20 }}>
        <div style={{ display: 'grid', gap: 6, textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--ink)' }}>
            {t('welcome.title')}
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)' }}>{t('welcome.lead')}</p>
        </div>

        <div
          style={{
            display: 'grid',
            // A un telèfon van una sota l'altra: dues targetes amb un dibuix a dins no
            // caben de costat a 390px sense que el dibuix deixi de dir res.
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 14,
          }}
        >
          {card('multi', t('welcome.multi'), t('welcome.multi.body'))}
          {card('single', t('welcome.single'), t('welcome.single.body'))}
        </div>

        {/*
          **La sortida no és un botó de «després», és aquesta frase.** El que fa que triar
          no faci por és saber que es desfà, i dir-ho aquí evita la tercera opció que
          tornaria a deixar la pregunta oberta.
        */}
        <p
          style={{
            margin: 0,
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--ink-faint)',
          }}
        >
          {t('welcome.changeable')}
        </p>
      </div>
    </main>
  );
}
