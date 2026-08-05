46x26 capsule toggle with a 20px white knob; on-state uses the 2-stop blue→pink gradient.

\`\`\`jsx
<Switch label="Mostrar intensidad en mm/h" checked={mm} onChange={setMm} />
<Switch checked={false} onChange={fn} />   {/* bare track */}
\`\`\`

In settings lists, always pass \`label\` so the row spacing matches the rest of the screen. Off-state is the neutral \`--track-off\`, never grey-on-grey text.
