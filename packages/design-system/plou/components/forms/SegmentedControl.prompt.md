Plou's primary choice control — a capsule track where the active option wears the brand gradient. Replaces radio groups and tabs everywhere.

\`\`\`jsx
<SegmentedControl block options={['Castellano', 'Català', 'English']} value={lang} onChange={setLang} />
<SegmentedControl size="sm" options={['Sistema', 'Claro', 'Oscuro']} value={theme} onChange={setTheme} />
<SegmentedControl options={['°C', '°F']} style={{ width: 110 }} />
\`\`\`

Used for language, theme, units, alarm intensity, schedule and notification type. The gradient on the active segment counts as the view's one gradient accent — don't also put a primary Button next to it in the same block.
