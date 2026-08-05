Thin 4px track with an 18px gradient thumb — used for the alarm radius, radar timeline and opacity/speed settings.

\`\`\`jsx
<Slider label="Radio de vigilancia" valueLabel="20 km" min={5} max={50} value={20} onChange={setRadius} />
\`\`\`

Requires \`styles.css\` (the \`.plou-range\` rules style the native thumb). The current value always appears in the label, never as a floating bubble.
