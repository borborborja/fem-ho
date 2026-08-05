Pill-shaped action button; the gradient \`primary\` variant is the single most important accent on a Plou screen.

\`\`\`jsx
<Button>+ Vigilar este punto</Button>
<Button variant="ghost">Editar</Button>
<Button variant="danger" size="md">Eliminar</Button>
<Button variant="glass" icon={<Icon name="crosshair" size={16} />}>Mi ubicación</Button>
\`\`\`

Rule: exactly one \`primary\` per view — everything else is \`ghost\`. \`danger\` is the only place a red appears in Plou. \`glass\` sits on top of the radar map; \`onAlert\` (white on gradient) is for the full-screen alert. Hover brightens 4%, press scales to 0.97.
