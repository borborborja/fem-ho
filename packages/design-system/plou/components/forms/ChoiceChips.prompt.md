Wrapping pill choices — the long-list sibling of SegmentedControl. Inactive chips are ghost fill with a hairline border; the selected chip takes the brand gradient.

\`\`\`jsx
<ChoiceChips
  options={['Blanco y negro', 'Original', 'Azul universal', 'Titan', 'The Weather Channel', 'Meteored', 'NEXRAD nivel III', 'Arcoíris (Selex SI)', 'Dark Sky']}
  value={scale} onChange={setScale}
/>
<ChoiceChips size="sm" options={['km/h', 'm/s', 'mph', 'kn', 'Bft']} value={unit} onChange={setUnit} />
\`\`\`

Use it for the radar colour scale, base map, history window and any unit row with 3+ options. Two-option rows stay on SegmentedControl.
