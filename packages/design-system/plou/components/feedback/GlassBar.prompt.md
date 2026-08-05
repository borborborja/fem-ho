Translucent dark container that floats over the radar map — blur + 50% dark fill + hairline white border, white text in both themes.

\`\`\`jsx
<GlassBar style={{ position: 'absolute', left: 16, right: 16, bottom: 20 }}>
  <IconButton tone="gradient" size={34} label="Pausar"><Icon name="pause" size={12} /></IconButton>
  <Slider value={70} />
  <div style={{ textAlign: 'right' }}>
    <div style={{ fontWeight: 900, fontSize: 14 }}>11:40</div>
    <div style={{ fontSize: 10, color: 'var(--glass-text-faint)' }}>−120 min</div>
  </div>
</GlassBar>
\`\`\`

Only ever used on top of the map — on themed surfaces use \`<Card>\` instead.
