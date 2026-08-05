The Ajustes building block: a titled card whose settings rows are divided by \`--divider-soft\` hairlines. Pass one \`<SettingsRow>\` per setting and the dividers place themselves.

\`\`\`jsx
<SettingsGroup title="Unidades">
  <SettingsRow label="Temperatura" inline><SegmentedControl options={['°C', '°F']} style={{ width: 110 }} /></SettingsRow>
  <SettingsRow label="Viento"><ChoiceChips size="sm" options={['km/h', 'm/s', 'mph', 'kn', 'Bft']} value="km/h" /></SettingsRow>
  <SettingsRow label="Mantener la pantalla encendida" inline><Switch checked={false} /></SettingsRow>
</SettingsGroup>
\`\`\`

Use \`inline\` for two-option and switch rows; stacked (default) when the control is a chip group that needs the full width. \`note\` carries a status line like "Zona horaria: Europe/Madrid".
