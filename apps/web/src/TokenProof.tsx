/**
 * Pàgina de prova de M1.
 *
 * Criteri d'acceptació de docs/13: "una pàgina de prova pinta un Button de Plou amb el
 * gradient correcte als quatre accents i als dos temes".
 *
 * Serveix per a dues coses més que costen molt de detectar altrament:
 *
 *  1. Que `accents.css` s'importi l'últim. Si es desordena, tots els accents es veuen
 *     igual — no hi ha cap error, només deixa de funcionar.
 *  2. Que `--column-bg` existeixi als dos temes. Al prototip era un literal invisible
 *     en fosc (docs/04 §2), i és el bug que aquesta cel·la fa saltar a la vista.
 */

import { Button, Card, Tag } from '@fem-ho/design-system/plou';

const THEMES = ['light', 'dark'] as const;
const ACCENTS = ['default', 'soft', 'mono-warm', 'mono-cool'] as const;

function AccentCell({ theme, accent }: { theme: string; accent: string }) {
  return (
    <div
      data-theme={theme}
      data-accent={accent}
      // L'arrel de la pàgina també porta data-theme i data-accent, o sigui que un
      // selector per atributs agafaria les dues coses. Aquest identificador fa que la
      // prova apunti a la cel·la i no al contenidor.
      data-testid={`cell-${theme}-${accent}`}
      style={{
        background: 'var(--page-bg)',
        color: 'var(--ink)',
        padding: 'var(--space-5, 20px)',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--card-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.04em' }}>
          {accent.toUpperCase()}
        </span>
        <Tag size="sm">{theme === 'light' ? 'clar' : 'fosc'}</Tag>
      </div>

      {/* Un sol primari per vista, i el text amb var(--on-brand), mai #fff literal:
          amb l'accent `soft` --on-brand passa a fosc i el blanc es trencaria. */}
      <Button variant="primary" size="md">
        Afegir tasca
      </Button>
      <Button variant="ghost" size="md">
        Cancel·lar
      </Button>

      {/* El token que el prototip no tenia. Si aquesta caixa és invisible en fosc,
          --column-bg no s'ha aplicat. */}
      <div
        data-testid="column-bg"
        style={{
          background: 'var(--column-bg)',
          border: '1px solid var(--card-border)',
          borderRadius: 14,
          padding: '10px 12px',
          fontSize: 12,
          color: 'var(--ink-soft)',
        }}
      >
        Fons de columna · <code>--column-bg</code>
      </div>
    </div>
  );
}

export function TokenProof() {
  return (
    <div
      data-theme="light"
      data-accent="default"
      style={{
        minHeight: '100vh',
        background: 'var(--page-bg)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-sans)',
        padding: 28,
      }}
    >
      <div style={{ maxWidth: 1360, margin: '0 auto' }}>
        <h1
          style={{
            fontWeight: 900,
            fontSize: 30,
            margin: '0 0 6px',
            background: 'var(--gradient-brand-text)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            width: 'fit-content',
          }}
        >
          Fem-ho
        </h1>
        <p style={{ color: 'var(--ink-soft)', fontSize: 13.5, margin: '0 0 24px' }}>
          Prova de tokens · 2 temes × 4 accents
        </p>

        {THEMES.map((theme) => (
          <Card
            key={theme}
            title={theme === 'light' ? 'Tema clar' : 'Tema fosc'}
            style={{ marginBottom: 18 }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 16,
              }}
            >
              {ACCENTS.map((accent) => (
                <AccentCell key={accent} theme={theme} accent={accent} />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
