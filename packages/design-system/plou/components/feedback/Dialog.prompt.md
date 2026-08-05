Centred modal on a dimmed backdrop — used for "Editar alarma". 28px radius, 26px padding, 16px gap between field groups.

\`\`\`jsx
<Dialog title="Editar alarma" onClose={close} footer={<>
  <Button variant="ghost" block onClick={close}>Cancelar</Button>
  <Button block onClick={close}>Guardar</Button>
</>}>
  <TextField label="Nombre de la ubicación" defaultValue="Cornellà del Terri" />
  <SegmentedControl block options={['Débil', 'Moderada', 'Fuerte']} />
</Dialog>
\`\`\`

Positioned \`absolute\` so it can be scoped to a phone frame — put it inside a \`position:relative\` parent, or override to \`fixed\` for full-page use. Footer is always ghost-left / primary-right.
