The universal Plou surface — 24px radius, hairline border, soft neutral shadow.

\`\`\`jsx
<Card kicker="Próxima ventana" title="Sin lluvia hasta las 19:40" tone="washWarm">
  <p style={{ fontSize: 'var(--text-body-xs)', color: 'var(--ink-soft)' }}>Franja despejada estable…</p>
  <Tag>Se abre en 6h 20min</Tag>
</Card>
\`\`\`

Cards always carry \`--card-shadow\`; a border alone is never the only separation. Use \`tone="washCool|washWarm"\` for at most one emphasised card per view, and \`tone="glass"\` only for sheets sitting on the radar map (its text is dark in both themes).
