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
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (next: T) => void;
  testId: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-testid={testId}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          data-testid={`${testId}-${option.key}`}
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
          style={{
            padding: '7px 14px',
            borderRadius: 100,
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 12,
            fontWeight: value === option.key ? 700 : 500,
            border: '1px solid var(--card-border)',
            background: value === option.key ? 'var(--ghost-bg)' : 'transparent',
            color: 'var(--ink)',
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
