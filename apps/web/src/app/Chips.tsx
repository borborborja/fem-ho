/**
 * Una fila de píndoles per triar-ne una.
 *
 * Vivia dins de `SettingsScreen` i ara la fan servir dues pantalles. Surt aquí i no s'hi
 * importa d'una pantalla a l'altra: dues pantalles que s'importen components entre elles
 * és com s'acaba amb un cicle i amb un canvi d'ajustos que trenca el tauler.
 *
 * No va al design system perquè no és de Plou: és una composició de Fem-ho feta amb els
 * seus tokens.
 */

export function Chips<T extends string>({
  value,
  options,
  onChange,
  testId,
  groupLabel,
  disabled,
}: {
  value: T;
  options: {
    key: T;
    label: string;
    /** Quants n'hi ha. **Veure el número és el que fa entendre el botó abans de clicar-lo.** */
    count?: number;
    /** La frase sencera, per a qui s'hi atura o hi navega amb lector de pantalla. */
    hint?: string;
  }[];
  onChange: (next: T) => void;
  testId: string;
  /** Què tria aquesta fila. Sense això, tres adjectius solts no diuen de què parlen. */
  groupLabel?: string;
  /**
   * La tria està decidida per algú altre.
   *
   * **Es desactiva i no s'amaga.** Un ajust que desapareix fa pensar que l'app l'ha perdut;
   * un de desactivat amb el motiu al costat diu qui l'ha decidit i que no és cosa teva.
   */
  disabled?: boolean;
}) {
  return (
    <div
      style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
      data-testid={testId}
      role="group"
      {...(groupLabel === undefined ? {} : { 'aria-label': groupLabel })}
    >
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          data-testid={`${testId}-${option.key}`}
          aria-pressed={value === option.key}
          disabled={disabled === true}
          {...(option.hint === undefined ? {} : { title: option.hint, 'aria-label': option.hint })}
          onClick={() => onChange(option.key)}
          style={{
            padding: '7px 14px',
            borderRadius: 100,
            cursor: disabled === true ? 'default' : 'pointer',
            opacity: disabled === true ? 0.55 : 1,
            font: 'inherit',
            fontSize: 12,
            fontWeight: value === option.key ? 700 : 500,
            border: '1px solid var(--card-border)',
            background: value === option.key ? 'var(--ghost-bg)' : 'transparent',
            color: 'var(--ink)',
          }}
        >
          {option.label}
          {option.count === undefined ? null : (
            <span
              aria-hidden="true"
              style={{
                marginLeft: 6,
                opacity: 0.65,
                fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {option.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
