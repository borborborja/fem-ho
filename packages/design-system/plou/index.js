/**
 * Barril de Plou. És l'ÚNIC fitxer d'aquesta carpeta que no ve del zip: la resta està
 * vendoritzada tal com ve i no es reescriu (docs/04 §1).
 *
 * Els 9 components de meteorologia i AlertScreen no s'exporten perquè no s'han
 * vendoritzat: docs/04 §3 els descarta i avisa de no reaprofitar-los "perquè
 * s'assemblen" — LocationCard no és una targeta de tasca.
 *
 * Slider i GlassBar sí que hi són, sense ús a la v1. Slider només per a valors
 * continus; per a tries discretes hi ha SegmentedControl i ChoiceChips.
 */

export { Button } from './components/core/Button.jsx';
export { Card } from './components/core/Card.jsx';
// PLOU_ICONS porta 10 glifs de meteorologia. Només en serveixen tres —bell, settings i
// search— i la resta del joc el dibuixa Fem-ho (docs/04 §5).
export { Icon, PLOU_ICONS } from './components/core/Icon.jsx';
export { IconButton } from './components/core/IconButton.jsx';
export { Tag } from './components/core/Tag.jsx';
export { Wordmark } from './components/core/Wordmark.jsx';

export { ChoiceChips } from './components/forms/ChoiceChips.jsx';
export { SegmentedControl } from './components/forms/SegmentedControl.jsx';
export { SettingsGroup, SettingsRow } from './components/forms/SettingsGroup.jsx';
export { Slider } from './components/forms/Slider.jsx';
export { Switch } from './components/forms/Switch.jsx';
export { TextField } from './components/forms/TextField.jsx';

export { NavItem } from './components/navigation/NavItem.jsx';
export { TabBar } from './components/navigation/TabBar.jsx';

export { Dialog } from './components/feedback/Dialog.jsx';
export { GlassBar } from './components/feedback/GlassBar.jsx';
