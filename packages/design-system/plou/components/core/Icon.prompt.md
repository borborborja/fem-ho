The complete Plou glyph set — line icons at 1.8px stroke, used in nav, controls and feature bubbles.

\`\`\`jsx
<Icon name="radar" size={20} />
<Icon name="sun" size={30} color="#fff" />   {/* inside a gradient bubble */}
<Icon name="play" size={13} />                {/* play/pause are solid, not stroked */}
\`\`\`

Names: radar, forecast, bell, settings, crosshair, search, sun, layers, play, pause.
Stroke width is automatic (1.8 below 30px, 1.6 at/above) — pass \`strokeWidth\` only to override. Icons inherit \`currentColor\`, so colour them by setting \`color\` on the parent. Never fill a stroked glyph.
