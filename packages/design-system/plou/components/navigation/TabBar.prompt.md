The mobile bottom switcher: a floating 64px glass capsule, icon-only, with the active tab in a gradient pill.

\`\`\`jsx
<TabBar
  value={tab}
  onChange={setTab}
  tabs={[
    { value: 'radar', label: 'Radar', icon: <Icon name="radar" /> },
    { value: 'prevision', label: 'Previsión', icon: <Icon name="forecast" /> },
    { value: 'alarmas', label: 'Alarmas', icon: <Icon name="bell" /> },
    { value: 'ajustes', label: 'Ajustes', icon: <Icon name="settings" /> },
  ]}
/>
\`\`\`

No text labels — the icons carry it (labels go to \`title\`/\`aria-label\`). It floats over content with blur, so scrollable views need ~104px of bottom padding.
