/* @ds-bundle: {"format":4,"namespace":"PlouDesignSystem_093e07","components":[{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"PLOU_ICONS","sourcePath":"components/core/Icon.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"Wordmark","sourcePath":"components/core/Wordmark.jsx"},{"name":"AlertScreen","sourcePath":"components/feedback/AlertScreen.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"GlassBar","sourcePath":"components/feedback/GlassBar.jsx"},{"name":"ChoiceChips","sourcePath":"components/forms/ChoiceChips.jsx"},{"name":"SegmentedControl","sourcePath":"components/forms/SegmentedControl.jsx"},{"name":"SettingsGroup","sourcePath":"components/forms/SettingsGroup.jsx"},{"name":"SettingsRow","sourcePath":"components/forms/SettingsGroup.jsx"},{"name":"Slider","sourcePath":"components/forms/Slider.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"TextField","sourcePath":"components/forms/TextField.jsx"},{"name":"NavItem","sourcePath":"components/navigation/NavItem.jsx"},{"name":"TabBar","sourcePath":"components/navigation/TabBar.jsx"},{"name":"ChartLegend","sourcePath":"components/weather/ChartLegend.jsx"},{"name":"HourlyList","sourcePath":"components/weather/HourlyList.jsx"},{"name":"LocationCard","sourcePath":"components/weather/LocationCard.jsx"},{"name":"MapControls","sourcePath":"components/weather/MapControls.jsx"},{"name":"ZoomControl","sourcePath":"components/weather/MapControls.jsx"},{"name":"PrecipChart","sourcePath":"components/weather/PrecipChart.jsx"},{"name":"RadarViewport","sourcePath":"components/weather/RadarViewport.jsx"},{"name":"StatTile","sourcePath":"components/weather/StatTile.jsx"},{"name":"TempReadout","sourcePath":"components/weather/TempReadout.jsx"}],"sourceHashes":{"components/core/Button.jsx":"38afc7b34a04","components/core/Card.jsx":"0efb3418e6f8","components/core/Icon.jsx":"3a4ead02a468","components/core/IconButton.jsx":"1520648b6319","components/core/Tag.jsx":"81afa458fe15","components/core/Wordmark.jsx":"1edd3247b25a","components/feedback/AlertScreen.jsx":"1fb755b8360c","components/feedback/Dialog.jsx":"9dc0e30806c7","components/feedback/GlassBar.jsx":"90f999c0cf6a","components/forms/ChoiceChips.jsx":"03c2f07792ea","components/forms/SegmentedControl.jsx":"56d936b0ee94","components/forms/SettingsGroup.jsx":"d90fa5bd6269","components/forms/Slider.jsx":"51d9a12caf6c","components/forms/Switch.jsx":"10565c26d04f","components/forms/TextField.jsx":"982ad7efb54d","components/navigation/NavItem.jsx":"aee281550f20","components/navigation/TabBar.jsx":"fbc8fac9d0f4","components/weather/ChartLegend.jsx":"9406d317430c","components/weather/HourlyList.jsx":"2358f68e01df","components/weather/LocationCard.jsx":"1ccbd98f7d72","components/weather/MapControls.jsx":"e582866c3287","components/weather/PrecipChart.jsx":"d9257c376677","components/weather/RadarViewport.jsx":"16cf5fec3836","components/weather/StatTile.jsx":"b4a28e102237","components/weather/TempReadout.jsx":"83301eb4c265","ui_kits/plou_app/AlarmsScreen.jsx":"de6147cfbbb9","ui_kits/plou_app/ForecastScreen.jsx":"df4d42e5d33b","ui_kits/plou_app/PhoneFrame.jsx":"04ac5c963f0e","ui_kits/plou_app/PlouAppShell.jsx":"479ebbccf578","ui_kits/plou_app/RadarScreen.jsx":"1ab973cdbb37","ui_kits/plou_app/SettingsScreen.jsx":"801edc8ed10e","ui_kits/plou_web/AlarmsPanel.jsx":"74485fb894ce","ui_kits/plou_web/ForecastPanel.jsx":"02111023009b","ui_kits/plou_web/PlouWebShell.jsx":"d0246055c3d7","ui_kits/plou_web/RadarPanel.jsx":"eeac657b1488","ui_kits/plou_web/SettingsPanel.jsx":"e11bb91338ef","ui_kits/plou_web/Sidebar.jsx":"7764aed212f3"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.PlouDesignSystem_093e07 = window.PlouDesignSystem_093e07 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const BASE = {
  borderRadius: 'var(--radius-pill)',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontWeight: 'var(--weight-bold)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-2)',
  whiteSpace: 'nowrap',
  transition: 'transform var(--dur-instant) var(--ease-standard), filter var(--dur-fast) var(--ease-standard), opacity var(--dur-fast) var(--ease-standard)'
};
const VARIANTS = {
  primary: {
    background: 'var(--gradient-brand)',
    color: 'var(--on-brand)',
    boxShadow: 'var(--shadow-primary)'
  },
  ghost: {
    background: 'var(--ghost-bg)',
    color: 'var(--ghost-text)'
  },
  danger: {
    background: 'var(--danger-bg)',
    color: 'var(--danger-text)'
  },
  glass: {
    background: 'var(--glass-fill)',
    color: 'var(--glass-text)'
  },
  onAlert: {
    background: '#fff',
    color: '#1a2a5c'
  }
};
const SIZES = {
  sm: {
    padding: 'var(--pad-btn-sm)',
    fontSize: 'var(--text-label)'
  },
  md: {
    padding: 'var(--pad-btn-mobile)',
    fontSize: 'var(--text-body-xs)'
  },
  lg: {
    padding: 'var(--pad-btn)',
    fontSize: 'var(--text-body-sm)'
  }
};
function Button({
  variant = 'primary',
  size = 'lg',
  icon,
  iconPosition = 'left',
  block,
  disabled,
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", _extends({
    disabled: disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setPress(false);
    },
    onMouseDown: () => setPress(true),
    onMouseUp: () => setPress(false),
    style: {
      ...BASE,
      ...SIZES[size],
      ...VARIANTS[variant],
      width: block ? '100%' : undefined,
      flex: block ? '1' : undefined,
      filter: hover && !disabled ? 'brightness(1.04)' : 'none',
      transform: press && !disabled ? 'scale(var(--press-scale))' : 'none',
      opacity: disabled ? 0.45 : 1,
      boxShadow: disabled ? 'none' : VARIANTS[variant].boxShadow,
      cursor: disabled ? 'not-allowed' : 'pointer',
      ...style
    }
  }, rest), icon && iconPosition === 'left' ? icon : null, children, icon && iconPosition === 'right' ? icon : null);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONES = {
  surface: {
    background: 'var(--card-bg)'
  },
  washCool: {
    background: 'var(--gradient-wash-cool)'
  },
  washWarm: {
    background: 'var(--gradient-wash-warm)'
  },
  glass: {
    background: 'var(--glass-sheet-bg)',
    backdropFilter: 'var(--blur-glass)',
    boxShadow: 'var(--shadow-glass)',
    border: 'none',
    color: '#14151a'
  }
};
const PADS = {
  tile: 'var(--pad-tile)',
  tight: 'var(--pad-card-tight)',
  mobile: 'var(--pad-card-mobile)',
  comfy: 'var(--pad-card)'
};
const RADII = {
  tile: 'var(--radius-card-sm)',
  tight: 'var(--radius-card-tight)',
  mobile: 'var(--radius-card)',
  comfy: 'var(--radius-card)'
};
function Card({
  tone = 'surface',
  density = 'comfy',
  kicker,
  title,
  meta,
  children,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      border: '1px solid var(--card-border)',
      borderRadius: RADII[density],
      padding: PADS[density],
      boxShadow: 'var(--card-shadow)',
      boxSizing: 'border-box',
      ...TONES[tone],
      ...style
    }
  }, rest), kicker ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-kicker)',
      fontWeight: 'var(--weight-bold)',
      letterSpacing: 'var(--tracking-caps)',
      color: 'var(--kicker)',
      textTransform: 'uppercase'
    }
  }, kicker) : null, title || meta ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: 'var(--space-3)',
      marginTop: kicker ? 'var(--space-2)' : 0
    }
  }, title ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 800,
      fontSize: 'var(--text-card-title)'
    }
  }, title) : null, meta ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-kicker)',
      color: 'var(--ink-faint)',
      flex: 'none'
    }
  }, meta) : null) : null, children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// The Plou icon set — hand-drawn 24x24 line glyphs, stroke:currentColor, round caps.
// Never filled, except play/pause (solid, always inside a gradient bubble).
const PLOU_ICONS = {
  radar: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "9"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "4.5"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "1"
  })),
  forecast: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "7.5",
    cy: "6.5",
    r: "2.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M7.5 2v1.4M7.5 9.6V11M3.9 6.5H2.5M12.5 6.5h-1.4M4.6 3.6l1 1M9.4 3.6l-1 1"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M18 20H8a3.5 3.5 0 01-.5-6.96A4.5 4.5 0 0116 12a3.5 3.5 0 012 8z"
  })),
  bell: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M13.7 21a2 2 0 01-3.4 0"
  })),
  settings: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009.5 19.6a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9.5a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"
  })),
  crosshair: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 2v3M12 19v3M2 12h3M19 12h3"
  })),
  search: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "11",
    cy: "11",
    r: "7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M21 21l-4.3-4.3"
  })),
  sun: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "4.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"
  })),
  layers: /*#__PURE__*/React.createElement("path", {
    d: "M4 7h16M4 12h16M4 17h16"
  })
};
const SOLID = {
  play: /*#__PURE__*/React.createElement("path", {
    d: "M6 4l14 8-14 8V4z"
  }),
  pause: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "6",
    y: "4",
    width: "4",
    height: "16"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "14",
    y: "4",
    width: "4",
    height: "16"
  }))
};
function Icon({
  name,
  size = 20,
  strokeWidth,
  color = 'currentColor',
  style,
  ...rest
}) {
  const solid = SOLID[name];
  const sw = strokeWidth != null ? strokeWidth : size >= 30 ? 1.6 : 1.8;
  return /*#__PURE__*/React.createElement("svg", _extends({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: solid ? color : 'none',
    stroke: solid ? 'none' : color,
    strokeWidth: solid ? undefined : sw,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      flex: 'none',
      display: 'block',
      ...style
    },
    "aria-hidden": "true"
  }, rest), solid || PLOU_ICONS[name] || PLOU_ICONS.radar);
}
Object.assign(__ds_scope, { PLOU_ICONS, Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONES = {
  neutral: {
    background: 'var(--fab-bg)',
    color: 'var(--fab-text)',
    border: 'none'
  },
  glass: {
    background: 'var(--glass-fill)',
    color: 'var(--glass-text)',
    border: 'none'
  },
  glassOutlined: {
    background: 'var(--glass-bg)',
    color: 'var(--glass-text)',
    border: '1px solid var(--glass-border)',
    backdropFilter: 'var(--blur-glass)'
  },
  gradient: {
    background: 'var(--gradient-brand-alt)',
    color: 'var(--on-brand)',
    border: 'none'
  }
};
function IconButton({
  tone = 'neutral',
  size = 38,
  label,
  children,
  style,
  ...rest
}) {
  const [press, setPress] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", _extends({
    title: label,
    "aria-label": label,
    onMouseDown: () => setPress(true),
    onMouseUp: () => setPress(false),
    onMouseLeave: () => setPress(false),
    style: {
      width: size,
      height: size,
      flex: 'none',
      borderRadius: 'var(--radius-circle)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      padding: 0,
      transition: 'transform var(--dur-instant) var(--ease-standard)',
      transform: press ? 'scale(var(--press-scale))' : 'none',
      ...TONES[tone],
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Tag({
  tone = 'neutral',
  size = 'md',
  icon,
  children,
  style,
  ...rest
}) {
  const tones = {
    neutral: {
      background: 'var(--tag-bg)',
      color: 'var(--tag-text)'
    },
    accent: {
      background: 'var(--gradient-wash-tag)',
      color: 'var(--tag-text)'
    },
    glass: {
      background: 'var(--glass-bg-strong)',
      color: '#fff'
    },
    onAlert: {
      background: 'rgba(255,255,255,0.2)',
      color: '#fff'
    }
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      fontSize: size === 'sm' ? 'var(--text-tag)' : 'var(--text-label)',
      fontWeight: 600,
      padding: size === 'sm' ? 'var(--pad-tag-sm)' : 'var(--pad-tag)',
      borderRadius: 'var(--radius-pill)',
      ...tones[tone],
      ...style
    }
  }, rest), icon, children);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/core/Wordmark.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Plou has no logo mark. The brand is the word "Plou" set in Roboto 900,
// either as gradient-clipped text (on themed surfaces) or flat white (over the map).
function Wordmark({
  size = 24,
  tone = 'gradient',
  place,
  style,
  ...rest
}) {
  const word = {
    fontFamily: 'var(--font-sans)',
    fontWeight: 'var(--weight-black)',
    fontSize: size,
    letterSpacing: 'var(--tracking-snug)',
    lineHeight: 1,
    ...(tone === 'gradient' ? {
      background: 'var(--gradient-brand-text)',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent'
    } : {
      color: tone === 'white' ? '#fff' : 'var(--ink)'
    })
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 'var(--space-4)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: word
  }, "Plou"), place ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: size * 0.54,
      color: tone === 'white' ? 'var(--glass-text-soft)' : 'var(--ink-soft)',
      fontWeight: 'var(--weight-regular)'
    }
  }, place) : null);
}
Object.assign(__ds_scope, { Wordmark });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Wordmark.jsx", error: String((e && e.message) || e) }); }

// components/feedback/AlertScreen.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function AlertScreen({
  place,
  headline = 'Lluvia moderada en 12 min',
  detail,
  time = '12:00',
  intensity = 4,
  size = 'mobile',
  actions,
  style,
  ...rest
}) {
  const mobile = size === 'mobile';
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      position: 'absolute',
      inset: 0,
      zIndex: 20,
      background: 'var(--gradient-alert)',
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-14)',
      textAlign: 'center',
      gap: mobile ? 'var(--space-7)' : 'var(--space-8)',
      boxSizing: 'border-box',
      ...style
    },
    role: "alertdialog"
  }, rest), place ? /*#__PURE__*/React.createElement(__ds_scope.Tag, {
    tone: "onAlert"
  }, place) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      width: mobile ? 80 : 90,
      height: mobile ? 80 : 90,
      borderRadius: 'var(--radius-circle)',
      background: 'rgba(255,255,255,0.18)',
      backdropFilter: 'var(--blur-soft)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: 'var(--shadow-bubble-glow)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "bell",
    size: mobile ? 38 : 42,
    color: "#fff"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 'var(--weight-black)',
      fontSize: mobile ? '26px' : 'var(--text-alert-title)',
      lineHeight: 'var(--leading-tight)'
    }
  }, headline), detail ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: mobile ? 'var(--text-body-xs)' : 'var(--text-body)',
      opacity: 0.85
    }
  }, detail) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 'var(--weight-black)',
      fontSize: mobile ? 'var(--text-hero-sm)' : 'var(--text-hero)',
      letterSpacing: 'var(--tracking-tight)',
      textShadow: '0 4px 20px rgba(0,0,0,0.3)'
    }
  }, time), intensity ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '5px',
      alignItems: 'flex-end',
      height: 28
    }
  }, [8, 14, 20, 28].map((h, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      width: 14,
      height: h,
      borderRadius: 'var(--radius-bar)',
      background: i < intensity ? i === intensity - 1 ? '#fff' : 'rgba(255,255,255,' + (0.3 + i * 0.12) + ')' : 'rgba(255,255,255,0.18)'
    }
  }))) : null, actions ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-4)',
      width: '100%',
      marginTop: 'var(--space-4)'
    }
  }, actions) : null);
}
Object.assign(__ds_scope, { AlertScreen });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/AlertScreen.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Dialog({
  open = true,
  title,
  width = 420,
  onClose,
  children,
  footer,
  style,
  ...rest
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'absolute',
      inset: 0,
      zIndex: 30,
      background: 'var(--dialog-backdrop)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-9)'
    }
  }, /*#__PURE__*/React.createElement("div", _extends({
    onClick: e => e.stopPropagation(),
    role: "dialog",
    "aria-modal": "true",
    style: {
      width: '100%',
      maxWidth: width,
      boxSizing: 'border-box',
      background: 'var(--dialog-bg)',
      color: 'var(--ink)',
      border: '1px solid var(--card-border)',
      borderRadius: 'var(--radius-dialog)',
      padding: 'var(--space-12)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-7)',
      boxShadow: 'var(--shadow-dialog)',
      ...style
    }
  }, rest), title ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 800,
      fontSize: 'var(--text-h2)'
    }
  }, title) : null, children, footer ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-3)',
      marginTop: 'var(--space-2)'
    }
  }, footer) : null));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/GlassBar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function GlassBar({
  shape = 'pill',
  children,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      background: 'var(--glass-bg)',
      backdropFilter: 'var(--blur-glass)',
      WebkitBackdropFilter: 'var(--blur-glass)',
      border: '1px solid var(--glass-border)',
      borderRadius: shape === 'pill' ? 'var(--radius-pill)' : 'var(--radius-card-tight)',
      padding: shape === 'pill' ? '8px 12px' : 'var(--pad-card-tight)',
      color: 'var(--glass-text)',
      boxSizing: 'border-box',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { GlassBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/GlassBar.jsx", error: String((e && e.message) || e) }); }

// components/forms/ChoiceChips.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// A wrapping group of pill choices. Plou uses this instead of SegmentedControl
// whenever there are more than four options (colour scales, wind units, base maps):
// the segmented track can't wrap, chips can.
function ChoiceChips({
  options = [],
  value,
  onChange,
  size = 'md',
  style,
  ...rest
}) {
  const norm = options.map(o => typeof o === 'string' ? {
    value: o,
    label: o
  } : o);
  const pads = {
    sm: '7px 13px',
    md: '9px 16px'
  };
  const fonts = {
    sm: 'var(--text-label)',
    md: 'var(--text-body-xs)'
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 'var(--gap-dense)',
      ...style
    },
    role: "radiogroup"
  }, rest), norm.map(o => {
    const active = o.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: o.value,
      role: "radio",
      "aria-checked": active,
      onClick: () => onChange && onChange(o.value),
      style: {
        padding: pads[size],
        fontSize: fonts[size],
        fontFamily: 'var(--font-sans)',
        borderRadius: 'var(--radius-pill)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)',
        border: active ? 'none' : '1px solid var(--card-border)',
        background: active ? 'var(--gradient-brand-alt)' : 'var(--ghost-bg)',
        color: active ? 'var(--on-brand)' : 'var(--ink-soft)',
        fontWeight: active ? 'var(--weight-bold)' : 'var(--weight-medium)',
        boxShadow: active ? 'var(--shadow-primary)' : 'none'
      }
    }, o.label);
  }));
}
Object.assign(__ds_scope, { ChoiceChips });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/ChoiceChips.jsx", error: String((e && e.message) || e) }); }

// components/forms/SegmentedControl.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function SegmentedControl({
  options = [],
  value,
  onChange,
  size = 'md',
  block,
  style,
  ...rest
}) {
  const pads = {
    sm: '7px 8px',
    md: 'var(--pad-seg-opt)',
    mobile: '9px 10px'
  };
  const fonts = {
    sm: '11.5px',
    md: 'var(--text-body-xs)',
    mobile: '12.5px'
  };
  const norm = options.map(o => typeof o === 'string' ? {
    value: o,
    label: o
  } : o);
  const current = value != null ? value : norm[0] && norm[0].value;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      background: 'var(--seg-bg)',
      borderRadius: 'var(--radius-pill)',
      padding: size === 'sm' ? '3px' : 'var(--space-1)',
      gap: 'var(--space-1)',
      width: block ? '100%' : 'fit-content',
      boxSizing: 'border-box',
      ...style
    },
    role: "radiogroup"
  }, rest), norm.map(o => {
    const active = o.value === current;
    return /*#__PURE__*/React.createElement("button", {
      key: o.value,
      role: "radio",
      "aria-checked": active,
      onClick: () => onChange && onChange(o.value),
      style: {
        flex: block ? 1 : 'none',
        textAlign: 'center',
        border: 'none',
        cursor: 'pointer',
        padding: pads[size],
        fontSize: fonts[size],
        fontFamily: 'var(--font-sans)',
        borderRadius: 'var(--radius-pill)',
        whiteSpace: 'nowrap',
        transition: 'background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)',
        background: active ? 'var(--gradient-brand-alt)' : 'transparent',
        color: active ? 'var(--on-brand)' : 'var(--seg-text)',
        fontWeight: active ? 'var(--weight-bold)' : 'var(--weight-medium)'
      }
    }, o.label);
  }));
}
Object.assign(__ds_scope, { SegmentedControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SegmentedControl.jsx", error: String((e && e.message) || e) }); }

// components/forms/SettingsGroup.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Titled settings card whose rows are separated by hairlines. Each child of
// SettingsGroup.Row is a label + its control, stacked on mobile.
function SettingsGroup({
  title,
  note,
  density = 'comfy',
  children,
  style,
  ...rest
}) {
  const rows = React.Children.toArray(children);
  return /*#__PURE__*/React.createElement(__ds_scope.Card, _extends({
    density: density,
    style: style
  }, rest), title ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 'var(--weight-bold)',
      fontSize: 'var(--text-subtitle)',
      marginBottom: note ? 6 : 14
    }
  }, title) : null, note ? /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--text-body-xs)',
      color: 'var(--ink-soft)',
      margin: '0 0 14px'
    }
  }, note) : null, rows.map((row, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      padding: i === 0 ? '0 0 14px' : '14px 0',
      borderTop: i === 0 ? 'none' : '1px solid var(--divider-soft)',
      paddingBottom: i === rows.length - 1 ? 0 : 14
    }
  }, row)));
}
function SettingsRow({
  label,
  children,
  inline,
  style,
  ...rest
}) {
  if (inline) {
    return /*#__PURE__*/React.createElement("div", _extends({
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-5)',
        ...style
      }
    }, rest), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 'var(--text-body-xs)'
      }
    }, label), children);
  }
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
      ...style
    }
  }, rest), label ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-body-xs)',
      color: 'var(--ink-soft)'
    }
  }, label) : null, children);
}
Object.assign(__ds_scope, { SettingsGroup, SettingsRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SettingsGroup.jsx", error: String((e && e.message) || e) }); }

// components/forms/Slider.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Slider({
  min = 0,
  max = 100,
  step = 1,
  value,
  onChange,
  label,
  valueLabel,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '5px',
      width: '100%',
      ...style
    }
  }, label ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-tag)',
      color: 'var(--ink-soft)'
    }
  }, label, valueLabel ? ': ' + valueLabel : '') : null, /*#__PURE__*/React.createElement("input", _extends({
    type: "range",
    className: "plou-range",
    min: min,
    max: max,
    step: step,
    value: value,
    onChange: e => onChange && onChange(Number(e.target.value)),
    style: {
      WebkitAppearance: 'none',
      appearance: 'none',
      width: '100%',
      height: 4,
      borderRadius: 'var(--radius-bar)',
      background: 'var(--range-track)',
      outline: 'none'
    }
  }, rest)));
}
Object.assign(__ds_scope, { Slider });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Slider.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Switch({
  checked = false,
  onChange,
  label,
  style,
  ...rest
}) {
  const track = /*#__PURE__*/React.createElement("button", _extends({
    role: "switch",
    "aria-checked": checked,
    onClick: () => onChange && onChange(!checked),
    style: {
      width: 46,
      height: 26,
      flex: 'none',
      padding: 0,
      border: 'none',
      cursor: 'pointer',
      borderRadius: 'var(--radius-pill)',
      position: 'relative',
      background: checked ? 'var(--gradient-toggle)' : 'var(--track-off)',
      transition: 'background var(--dur-base) var(--ease-standard)'
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 3,
      left: checked ? 23 : 3,
      width: 20,
      height: 20,
      borderRadius: 'var(--radius-circle)',
      background: '#fff',
      boxShadow: 'var(--shadow-knob)',
      transition: 'left var(--dur-base) var(--ease-standard)'
    }
  }));
  if (!label) return track;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 'var(--space-5)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-body-xs)'
    }
  }, label), track);
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/TextField.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function TextField({
  label,
  tone = 'surface',
  shape = 'rounded',
  icon,
  style,
  ...rest
}) {
  const tones = {
    surface: {
      background: 'var(--input-bg)',
      border: '1px solid var(--input-border)',
      color: 'var(--ink)'
    },
    glass: {
      background: 'var(--glass-bg)',
      backdropFilter: 'var(--blur-glass)',
      border: '1px solid var(--glass-border)',
      color: '#fff'
    }
  };
  const input = /*#__PURE__*/React.createElement("input", _extends({
    style: {
      width: '100%',
      boxSizing: 'border-box',
      outline: 'none',
      borderRadius: shape === 'pill' ? 'var(--radius-pill)' : 'var(--radius-input)',
      padding: shape === 'pill' ? '11px 16px' : 'var(--pad-input)',
      fontSize: 'var(--text-body-xs)',
      fontFamily: 'var(--font-sans)',
      ...tones[tone]
    }
  }, rest));
  if (!label) return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flex: 1,
      ...style
    }
  }, input);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '5px',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-tag)',
      color: 'var(--ink-soft)'
    }
  }, label), input);
}
Object.assign(__ds_scope, { TextField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/TextField.jsx", error: String((e && e.message) || e) }); }

// components/navigation/NavItem.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function NavItem({
  icon,
  active,
  children,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-5)',
      padding: 'var(--space-5) var(--space-7)',
      borderRadius: 'var(--radius-nav)',
      cursor: 'pointer',
      fontWeight: 600,
      fontSize: 'var(--text-body)',
      border: 'none',
      width: '100%',
      textAlign: 'left',
      fontFamily: 'var(--font-sans)',
      transition: 'background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)',
      background: active ? 'var(--gradient-brand)' : 'transparent',
      color: active ? 'var(--on-brand)' : 'var(--nav-idle)',
      boxShadow: active ? 'var(--shadow-nav-active)' : 'none',
      ...style
    },
    "aria-current": active ? 'page' : undefined
  }, rest), icon, children);
}
Object.assign(__ds_scope, { NavItem });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/NavItem.jsx", error: String((e && e.message) || e) }); }

// components/navigation/TabBar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function TabBar({
  tabs = [],
  value,
  onChange,
  floating = true,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-around',
      height: 'var(--switcher-height)',
      padding: 'var(--space-2)',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--switcher-bg)',
      backdropFilter: 'var(--blur-switcher)',
      WebkitBackdropFilter: 'var(--blur-switcher)',
      border: '1px solid var(--switcher-border)',
      boxShadow: 'var(--switcher-shadow)',
      boxSizing: 'border-box',
      ...(floating ? {
        position: 'absolute',
        left: 22,
        right: 22,
        bottom: 'var(--switcher-inset)',
        zIndex: 5
      } : {}),
      ...style
    }
  }, rest), tabs.map(t => {
    const active = t.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: t.value,
      title: t.label,
      "aria-label": t.label,
      "aria-current": active ? 'page' : undefined,
      onClick: () => onChange && onChange(t.value),
      style: {
        flex: 1,
        height: 'var(--tab-hit)',
        borderRadius: 'var(--radius-pill)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        cursor: 'pointer',
        transition: 'background var(--dur-fast) var(--ease-standard)',
        background: active ? 'var(--gradient-brand)' : 'transparent',
        color: active ? 'var(--on-brand)' : 'var(--ink-soft)',
        boxShadow: active ? 'var(--shadow-tab-active)' : 'none'
      }
    }, t.icon);
  }));
}
Object.assign(__ds_scope, { TabBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/TabBar.jsx", error: String((e && e.message) || e) }); }

// components/weather/ChartLegend.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function ChartLegend({
  items = [],
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      gap: 'var(--space-7)',
      flexWrap: 'wrap',
      ...style
    }
  }, rest), items.map(it => /*#__PURE__*/React.createElement("div", {
    key: it.label,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: 3,
      background: it.color,
      flex: 'none'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-label)',
      color: 'var(--ink-soft)'
    }
  }, it.label))));
}
Object.assign(__ds_scope, { ChartLegend });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/weather/ChartLegend.jsx", error: String((e && e.message) || e) }); }

// components/weather/HourlyList.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function HourlyList({
  rows = [],
  dayLabel,
  showIcon,
  showPrecip,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: style
  }, rest), dayLabel ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-label)',
      fontWeight: 'var(--weight-bold)',
      color: 'var(--ink-faint)',
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-caps)',
      padding: '4px 0 8px'
    }
  }, dayLabel) : null, rows.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-5)',
      padding: 'var(--space-4) 0',
      borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--divider-soft)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 800,
      fontSize: 'var(--text-body-xs)',
      width: 48
    }
  }, r.time), showIcon ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: r.icon || 'sun',
    size: 17,
    style: {
      color: 'var(--ink-soft)'
    }
  }) : null, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 'var(--weight-bold)',
      fontSize: 'var(--text-body-xs)',
      width: 34
    }
  }, r.temp), showPrecip ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-label)',
      color: 'var(--ink-faint)',
      width: 44
    }
  }, r.precip || '—') : null, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-label)',
      color: 'var(--ink-faint)',
      flex: 1
    }
  }, r.wind), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-label)',
      color: 'var(--ink-faint)'
    }
  }, r.cond))));
}
Object.assign(__ds_scope, { HourlyList });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/weather/HourlyList.jsx", error: String((e && e.message) || e) }); }

// components/weather/LocationCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function LocationCard({
  name,
  status = 'Alarma activa',
  meta,
  intensity,
  schedule,
  notifType,
  notice,
  dot = 'var(--dot-1)',
  density = 'comfy',
  actions = true,
  onEdit,
  onCheck,
  onDelete,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement(__ds_scope.Card, _extends({
    density: density,
    style: style
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 800,
      fontSize: 'var(--text-h3)'
    }
  }, name), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 10,
      height: 10,
      borderRadius: 'var(--radius-circle)',
      background: dot,
      flex: 'none',
      marginTop: 5
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-meta)',
      color: 'var(--ink-soft)',
      marginTop: 2
    }
  }, status, meta ? ' · ' + meta : ''), intensity || schedule || notifType ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-2)',
      flexWrap: 'wrap',
      marginTop: 'var(--space-5)'
    }
  }, intensity ? /*#__PURE__*/React.createElement(__ds_scope.Tag, {
    size: "sm"
  }, "Intensidad: ", intensity) : null, schedule ? /*#__PURE__*/React.createElement(__ds_scope.Tag, {
    size: "sm"
  }, schedule) : null, notifType ? /*#__PURE__*/React.createElement(__ds_scope.Tag, {
    size: "sm",
    tone: "accent"
  }, notifType) : null) : null, notice ? /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--text-meta)',
      color: 'var(--ink-faint)',
      margin: 'var(--space-5) 0'
    }
  }, notice) : null, actions ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "ghost",
    size: "md",
    block: true,
    onClick: onEdit
  }, "Editar"), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "ghost",
    size: "md",
    block: true,
    onClick: onCheck
  }, "Comprobar"), onDelete ? /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "danger",
    size: "md",
    block: true,
    onClick: onDelete
  }, "Eliminar") : null) : null);
}
Object.assign(__ds_scope, { LocationCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/weather/LocationCard.jsx", error: String((e && e.message) || e) }); }

// components/weather/MapControls.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// The small glass pills that sit on the radar map: "Leyenda" bottom-left,
// "≡ Capas" bottom-right. Text-only, no icons except the layers bars glyph.
function MapControls({
  items = [],
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      gap: 'var(--space-3)',
      ...style
    }
  }, rest), items.map(it => /*#__PURE__*/React.createElement("button", {
    key: it.label,
    onClick: it.onClick,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      background: 'var(--glass-bg-strong)',
      backdropFilter: 'var(--blur-glass)',
      WebkitBackdropFilter: 'var(--blur-glass)',
      border: '1px solid var(--glass-border)',
      borderRadius: 'var(--radius-pill)',
      padding: '9px 16px',
      color: 'var(--glass-text)',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-body-xs)',
      fontWeight: 600,
      whiteSpace: 'nowrap'
    }
  }, it.glyph === 'layers' ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "layers",
    size: 14
  }) : null, it.label)));
}
function ZoomControl({
  onZoomIn,
  onZoomOut,
  style,
  ...rest
}) {
  const btn = {
    width: 34,
    height: 34,
    border: 'none',
    cursor: 'pointer',
    background: 'var(--glass-bg-strong)',
    color: 'var(--glass-text)',
    fontFamily: 'var(--font-sans)',
    fontSize: 17,
    fontWeight: 'var(--weight-bold)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      borderRadius: 'var(--radius-input)',
      border: '1px solid var(--glass-border)',
      backdropFilter: 'var(--blur-glass)',
      WebkitBackdropFilter: 'var(--blur-glass)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("button", {
    "aria-label": "Acercar",
    onClick: onZoomIn,
    style: {
      ...btn,
      borderBottom: '1px solid var(--glass-border)'
    }
  }, "+"), /*#__PURE__*/React.createElement("button", {
    "aria-label": "Alejar",
    onClick: onZoomOut,
    style: btn
  }, "\u2212"));
}
Object.assign(__ds_scope, { MapControls, ZoomControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/weather/MapControls.jsx", error: String((e && e.message) || e) }); }

// components/weather/PrecipChart.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Bars are drawn as 4px stubs when there is no precipitation — Plou never hides
// the axis, it shows an empty one plus a plain-language note.
function PrecipChart({
  title = 'Precipitación prevista (6 h)',
  data = [],
  height = 70,
  note,
  style,
  ...rest
}) {
  const max = Math.max(1, ...data.map(d => d.value || 0));
  return /*#__PURE__*/React.createElement("div", _extends({
    style: style
  }, rest), title ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 'var(--weight-bold)',
      fontSize: 'var(--text-subtitle)',
      marginBottom: 'var(--space-4)'
    }
  }, title) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      height,
      display: 'flex',
      alignItems: 'flex-end',
      gap: '5px',
      borderBottom: '1px solid var(--divider)'
    }
  }, data.map((d, i) => {
    const empty = !d.value;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        flex: 1,
        height: empty ? 4 : Math.max(6, d.value / max * height),
        borderRadius: 'var(--radius-bar)',
        background: empty ? 'var(--divider)' : 'var(--gradient-brand-2stop)',
        transition: 'height var(--dur-base) var(--ease-standard)'
      }
    });
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '10px',
      color: 'var(--ink-faint)',
      marginTop: 'var(--space-2)'
    }
  }, data.map((d, i) => /*#__PURE__*/React.createElement("span", {
    key: i
  }, d.time))), note ? /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--text-label)',
      color: 'var(--ink-faint)',
      margin: '10px 0 0'
    }
  }, note) : null);
}
Object.assign(__ds_scope, { PrecipChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/weather/PrecipChart.jsx", error: String((e && e.message) || e) }); }

// components/weather/RadarViewport.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// The radar map: a dark gradient substrate, the tile screenshot at 55% opacity in
// screen blend, a dashed watch-radius ring and a gradient pin. UI floats on top as children.
function RadarViewport({
  image,
  radius = 170,
  fullBleed = false,
  children,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      position: 'relative',
      overflow: 'hidden',
      borderRadius: fullBleed ? 0 : 'var(--radius-panel)',
      boxShadow: fullBleed ? 'none' : 'var(--shadow-map)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      background: 'var(--gradient-radar)'
    }
  }), image ? /*#__PURE__*/React.createElement("img", {
    src: image,
    alt: "",
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      opacity: 0.55,
      mixBlendMode: 'screen'
    }
  }) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: radius,
      height: radius,
      borderRadius: 'var(--radius-circle)',
      border: '2px dashed var(--ring-radar)',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: radius > 200 ? 14 : 12,
      height: radius > 200 ? 14 : 12,
      borderRadius: 'var(--radius-circle)',
      background: 'var(--gradient-toggle)',
      transform: 'translate(-50%,-50%)',
      boxShadow: 'var(--shadow-pin-glow)'
    }
  }))), children);
}
Object.assign(__ds_scope, { RadarViewport });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/weather/RadarViewport.jsx", error: String((e && e.message) || e) }); }

// components/weather/StatTile.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function StatTile({
  label,
  value,
  size = 'mobile',
  style,
  ...rest
}) {
  const desktop = size === 'desktop';
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: 'var(--card-bg)',
      border: '1px solid var(--card-border)',
      borderRadius: 'var(--radius-card-sm)',
      boxShadow: 'var(--card-shadow)',
      padding: desktop ? 'var(--pad-tile-lg)' : 'var(--pad-tile)',
      boxSizing: 'border-box',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: desktop ? '10px' : 'var(--text-micro)',
      letterSpacing: 'var(--tracking-caps-sm)',
      color: 'var(--ink-faint)',
      textTransform: 'uppercase'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 800,
      fontSize: desktop ? '18px' : 'var(--text-card-title)',
      marginTop: desktop ? '4px' : '3px'
    }
  }, value));
}
Object.assign(__ds_scope, { StatTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/weather/StatTile.jsx", error: String((e && e.message) || e) }); }

// components/weather/TempReadout.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function TempReadout({
  temp = '31°',
  condition = 'Despejado',
  place,
  icon = 'sun',
  size = 'mobile',
  style,
  ...rest
}) {
  const desktop = size === 'desktop';
  const bubble = desktop ? 76 : 64;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: desktop ? 'var(--space-9)' : 'var(--space-7)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      width: bubble,
      height: bubble,
      flex: 'none',
      borderRadius: 'var(--radius-circle)',
      background: 'var(--gradient-brand)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: 'var(--shadow-primary-lg)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: desktop ? 36 : 30,
    color: "var(--on-brand)"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 'var(--weight-black)',
      fontSize: desktop ? 'var(--text-display)' : 'var(--text-display-sm)',
      lineHeight: 1,
      letterSpacing: 'var(--tracking-tight)'
    }
  }, temp), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: desktop ? 'var(--text-body)' : 'var(--text-body-xs)',
      color: 'var(--ink-soft)',
      marginTop: '2px'
    }
  }, condition, place ? ' · ' + place : '')));
}
Object.assign(__ds_scope, { TempReadout });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/weather/TempReadout.jsx", error: String((e && e.message) || e) }); }

// ui_kits/plou_app/AlarmsScreen.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const ALARMS = [{
  name: 'Cornellà del Terri',
  status: 'Alarma activa',
  meta: '20 km',
  intensity: 'Débil',
  schedule: 'Todo el día',
  notifType: 'Automática',
  notice: 'Sin avisos todavía',
  dot: 'var(--dot-1)'
}, {
  name: 'Casa — Navata',
  status: 'Alarma activa',
  meta: '10 km',
  intensity: 'Moderada',
  schedule: 'Día',
  notifType: 'Pantalla completa',
  notice: 'Sin avisos todavía',
  dot: 'var(--dot-2)'
}, {
  name: 'Trabajo — Figueres',
  status: 'En pausa',
  meta: '15 km',
  intensity: 'Fuerte',
  schedule: 'Noche',
  notifType: 'Banner',
  notice: 'Última alerta hace 3 días',
  dot: 'var(--dot-3)'
}];
function AlarmsScreen({
  onEdit,
  onCheck
}) {
  const {
    Button,
    LocationCard,
    Card
  } = window.PlouDesignSystem_093e07;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "plou-eyebrow"
  }, "Mis ubicaciones"), /*#__PURE__*/React.createElement(Button, {
    size: "sm"
  }, "+ A\xF1adir")), ALARMS.map(a => /*#__PURE__*/React.createElement(LocationCard, _extends({
    key: a.name,
    density: "mobile"
  }, a, {
    onEdit: onEdit,
    onCheck: onCheck,
    onDelete: () => {}
  }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "plou-eyebrow",
    style: {
      marginBottom: 8
    }
  }, "Historial de avisos"), /*#__PURE__*/React.createElement(Card, {
    density: "mobile"
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 'var(--text-body-xs)',
      color: 'var(--ink-faint)'
    }
  }, "Todav\xEDa no se ha emitido ning\xFAn aviso."))));
}
window.AlarmsScreen = AlarmsScreen;
window.PLOU_ALARMS = ALARMS;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/plou_app/AlarmsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/plou_app/ForecastScreen.jsx
try { (() => {
const STATS = [['SENSACIÓN', '30°'], ['HUMEDAD', '32 %'], ['VIENTO', '6 km/h SE'], ['RACHAS', '22 km/h'], ['PRESIÓN', '1018 hPa'], ['NUBOSIDAD', '0 %'], ['VISIBILIDAD', '44 km'], ['ÍNDICE UV', '7.0 · Alto'], ['PUNTO DE ROCÍO', '13°']];
const HOURLY = [{
  time: '13:00',
  temp: '31°',
  wind: '5 km/h SE',
  cond: 'Despejado'
}, {
  time: '14:00',
  temp: '31°',
  wind: '6 km/h ESE',
  cond: 'Despejado'
}, {
  time: '15:00',
  temp: '33°',
  wind: '8 km/h SE',
  cond: 'Despejado'
}, {
  time: '16:00',
  temp: '33°',
  wind: '24 km/h SE',
  cond: 'Despejado'
}, {
  time: '17:00',
  temp: '32°',
  wind: '18 km/h SE',
  cond: 'Despejado'
}, {
  time: '18:00',
  temp: '30°',
  wind: '14 km/h S',
  cond: 'Despejado'
}];
function ForecastScreen({
  place
}) {
  const {
    TempReadout,
    StatTile,
    Card,
    Tag,
    PrecipChart,
    ChartLegend,
    HourlyList
  } = window.PlouDesignSystem_093e07;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 18
    }
  }, /*#__PURE__*/React.createElement(TempReadout, {
    temp: "31\xB0",
    condition: "Despejado",
    place: place
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: 8
    }
  }, STATS.map(([l, v]) => /*#__PURE__*/React.createElement(StatTile, {
    key: l,
    label: l,
    value: v
  }))), /*#__PURE__*/React.createElement(Card, {
    tone: "washCool",
    density: "mobile",
    kicker: "Pr\xF3xima ventana",
    title: "Sin lluvia hasta las 19:40"
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--text-body-xs)',
      color: 'var(--ink-soft)',
      margin: '6px 0 10px'
    }
  }, "Franja despejada estable durante las pr\xF3ximas 6 horas. Buen momento para salir sin paraguas."), /*#__PURE__*/React.createElement(Tag, {
    size: "sm"
  }, "Se abre en 6h 20min")), /*#__PURE__*/React.createElement(Card, {
    density: "mobile"
  }, /*#__PURE__*/React.createElement(PrecipChart, {
    data: HOURLY.map(h => ({
      time: h.time
    })),
    note: "No se espera precipitaci\xF3n en la ventana analizada."
  }), /*#__PURE__*/React.createElement(ChartLegend, {
    style: {
      marginTop: 10
    },
    items: [{
      label: 'Precipitación',
      color: 'var(--gradient-brand-2stop)'
    }, {
      label: 'Probabilidad',
      color: 'var(--divider)'
    }]
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "plou-eyebrow",
    style: {
      marginBottom: 8
    }
  }, "Por horas"), /*#__PURE__*/React.createElement(Card, {
    density: "mobile",
    style: {
      padding: '6px 16px'
    }
  }, /*#__PURE__*/React.createElement(HourlyList, {
    rows: HOURLY,
    dayLabel: "Lunes \xB7 27 jul",
    showIcon: true,
    showPrecip: true
  }))));
}
window.ForecastScreen = ForecastScreen;
window.PLOU_HOURLY = HOURLY;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/plou_app/ForecastScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/plou_app/PhoneFrame.jsx
try { (() => {
// Minimal Android device shell: bezel, status bar, gesture pill.
function PhoneFrame({
  width = 390,
  height = 844,
  theme = 'light',
  accent = 'mono-warm',
  children
}) {
  const dark = theme === 'dark';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: width + 22,
      height: height + 22,
      borderRadius: 54,
      padding: 11,
      background: dark ? '#1b1c22' : '#22242b',
      boxShadow: '0 30px 70px rgba(20,20,40,0.35)',
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement("div", {
    "data-theme": theme,
    "data-accent": accent,
    style: {
      position: 'relative',
      width,
      height,
      borderRadius: 44,
      overflow: 'hidden',
      background: 'var(--app-bg)',
      color: 'var(--ink)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 30,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 22px',
      fontSize: 11,
      fontWeight: 700,
      color: dark ? 'rgba(255,255,255,0.8)' : 'rgba(20,22,30,0.65)',
      zIndex: 40,
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement("span", null, "11:47"), /*#__PURE__*/React.createElement("span", {
    style: {
      letterSpacing: 2
    }
  }, "\u25AA \u25AA \u25AE")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: '30px 0 0 0'
    }
  }, children), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      bottom: 6,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 110,
      height: 4,
      borderRadius: 4,
      background: dark ? 'rgba(255,255,255,0.3)' : 'rgba(20,22,30,0.25)',
      zIndex: 40
    }
  })));
}
window.PhoneFrame = PhoneFrame;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/plou_app/PhoneFrame.jsx", error: String((e && e.message) || e) }); }

// ui_kits/plou_app/PlouAppShell.jsx
try { (() => {
function PlouApp() {
  const {
    Wordmark,
    IconButton,
    Icon,
    TabBar,
    Dialog,
    AlertScreen,
    Button,
    TextField,
    Slider,
    SegmentedControl
  } = window.PlouDesignSystem_093e07;
  const {
    PhoneFrame,
    RadarScreen,
    ForecastScreen,
    AlarmsScreen,
    SettingsScreen
  } = window;
  const TABS = [{
    value: 'radar',
    label: 'Radar',
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "radar"
    })
  }, {
    value: 'prevision',
    label: 'Previsión',
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "forecast"
    })
  }, {
    value: 'alarmas',
    label: 'Alarmas',
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "bell"
    })
  }, {
    value: 'ajustes',
    label: 'Ajustes',
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "settings"
    })
  }];
  const [tab, setTab] = React.useState('radar');
  const [themePick, setThemePick] = React.useState('Claro');
  const [playing, setPlaying] = React.useState(true);
  const [alert, setAlert] = React.useState(false);
  const [edit, setEdit] = React.useState(false);
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = themePick === 'Sistema' ? prefersDark ? 'dark' : 'light' : themePick === 'Oscuro' ? 'dark' : 'light';
  const place = 'Navata';
  return /*#__PURE__*/React.createElement(PhoneFrame, {
    theme: theme,
    accent: "mono-warm"
  }, tab === 'radar' ? /*#__PURE__*/React.createElement(RadarScreen, {
    place: place,
    playing: playing,
    onTogglePlay: () => setPlaying(p => !p),
    onOpenAlert: () => setAlert(true)
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '20px 20px 14px',
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    size: 22,
    place: place,
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(IconButton, {
    label: "Mi ubicaci\xF3n"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "crosshair",
    size: 17
  }))), /*#__PURE__*/React.createElement("div", {
    className: "plou-scroll",
    style: {
      flex: 1,
      overflow: 'auto',
      padding: '6px 18px 104px'
    }
  }, tab === 'prevision' ? /*#__PURE__*/React.createElement(ForecastScreen, {
    place: place
  }) : null, tab === 'alarmas' ? /*#__PURE__*/React.createElement(AlarmsScreen, {
    onEdit: () => setEdit(true),
    onCheck: () => setAlert(true)
  }) : null, tab === 'ajustes' ? /*#__PURE__*/React.createElement(SettingsScreen, {
    theme: themePick,
    onTheme: setThemePick
  }) : null)), /*#__PURE__*/React.createElement(TabBar, {
    tabs: TABS,
    value: tab,
    onChange: setTab
  }), alert ? /*#__PURE__*/React.createElement(AlertScreen, {
    place: place,
    headline: /*#__PURE__*/React.createElement(React.Fragment, null, "Lluvia moderada", /*#__PURE__*/React.createElement("br", null), "en 12 min"),
    detail: "Procedente del suroeste, hacia tu ubicaci\xF3n",
    time: "12:00",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "glass",
      size: "md",
      block: true,
      onClick: () => setAlert(false)
    }, "Posponer 10 min"), /*#__PURE__*/React.createElement(Button, {
      variant: "onAlert",
      size: "md",
      block: true,
      onClick: () => setAlert(false)
    }, "Silenciar"))
  }) : null, edit ? /*#__PURE__*/React.createElement(Dialog, {
    title: "Editar alarma",
    width: 999,
    onClose: () => setEdit(false),
    style: {
      borderRadius: 'var(--radius-dialog)',
      padding: 22
    },
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "md",
      block: true,
      onClick: () => setEdit(false)
    }, "Cancelar"), /*#__PURE__*/React.createElement(Button, {
      size: "md",
      block: true,
      onClick: () => setEdit(false)
    }, "Guardar"))
  }, /*#__PURE__*/React.createElement(TextField, {
    label: "Nombre de la ubicaci\xF3n",
    defaultValue: "Cornell\xE0 del Terri"
  }), /*#__PURE__*/React.createElement(Slider, {
    label: "Radio de vigilancia",
    valueLabel: "20 km",
    min: 5,
    max: 50,
    defaultValue: 20
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-tag)',
      color: 'var(--ink-soft)',
      marginBottom: 5
    }
  }, "Intensidad m\xEDnima"), /*#__PURE__*/React.createElement(SegmentedControl, {
    block: true,
    size: "mobile",
    options: ['Débil', 'Moderada', 'Fuerte'],
    value: "D\xE9bil"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-tag)',
      color: 'var(--ink-soft)',
      marginBottom: 5
    }
  }, "Horario activo"), /*#__PURE__*/React.createElement(SegmentedControl, {
    block: true,
    size: "mobile",
    options: ['Todo el día', 'Día', 'Noche'],
    value: "Todo el d\xEDa"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-tag)',
      color: 'var(--ink-soft)',
      marginBottom: 5
    }
  }, "Tipo de notificaci\xF3n"), /*#__PURE__*/React.createElement(SegmentedControl, {
    block: true,
    size: "mobile",
    options: ['Automática', 'Banner', 'Pantalla completa'],
    value: "Autom\xE1tica"
  }))) : null);
}
window.PlouApp = PlouApp;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/plou_app/PlouAppShell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/plou_app/RadarScreen.jsx
try { (() => {
function RadarScreen({
  place,
  playing,
  onTogglePlay,
  onOpenAlert
}) {
  const {
    Wordmark,
    IconButton,
    Icon,
    Tag,
    Button,
    TextField,
    Slider,
    GlassBar,
    Card,
    RadarViewport,
    MapControls,
    ZoomControl
  } = window.PlouDesignSystem_093e07;
  return /*#__PURE__*/React.createElement(RadarViewport, {
    image: "../../assets/radar-map-tile.png",
    radius: 170,
    fullBleed: true,
    style: {
      position: 'absolute',
      inset: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      padding: '18px 18px 40px',
      background: 'linear-gradient(180deg,rgba(10,10,16,0.55),transparent)',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      zIndex: 2
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    tone: "white",
    size: 21,
    place: place,
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(IconButton, {
    tone: "glass",
    label: "Mi ubicaci\xF3n"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "crosshair",
    size: 16
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 64,
      left: 16,
      right: 16,
      display: 'flex',
      gap: 8,
      zIndex: 2
    }
  }, /*#__PURE__*/React.createElement(TextField, {
    tone: "glass",
    shape: "pill",
    placeholder: "Buscar lugar\u2026"
  }), /*#__PURE__*/React.createElement(IconButton, {
    tone: "glassOutlined",
    label: "Buscar"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 16
  }))), /*#__PURE__*/React.createElement(Tag, {
    tone: "glass",
    style: {
      position: 'absolute',
      top: 118,
      left: 16,
      zIndex: 2
    }
  }, "Sin ecos de precipitaci\xF3n"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    style: {
      position: 'absolute',
      top: 112,
      right: 16,
      zIndex: 2
    }
  }, "+ Vigilar"), /*#__PURE__*/React.createElement(ZoomControl, {
    style: {
      position: 'absolute',
      left: 16,
      top: 160,
      zIndex: 2
    }
  }), /*#__PURE__*/React.createElement(MapControls, {
    style: {
      position: 'absolute',
      left: 16,
      bottom: 224,
      zIndex: 2
    },
    items: [{
      label: 'Leyenda'
    }]
  }), /*#__PURE__*/React.createElement(MapControls, {
    style: {
      position: 'absolute',
      right: 16,
      bottom: 224,
      zIndex: 2
    },
    items: [{
      label: 'Capas',
      glyph: 'layers'
    }]
  }), /*#__PURE__*/React.createElement(GlassBar, {
    style: {
      position: 'absolute',
      left: 16,
      right: 16,
      bottom: 172,
      zIndex: 2
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    tone: "gradient",
    size: 34,
    label: playing ? 'Pausar' : 'Reproducir',
    onClick: onTogglePlay
  }, /*#__PURE__*/React.createElement(Icon, {
    name: playing ? 'pause' : 'play',
    size: 12
  })), /*#__PURE__*/React.createElement(Slider, {
    value: 70,
    onChange: () => {}
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right',
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 900,
      fontSize: 13
    }
  }, "11:40"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: 'var(--glass-text-faint)'
    }
  }, "\u2212120 min"))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 16,
      right: 16,
      bottom: 92,
      zIndex: 2
    }
  }, /*#__PURE__*/React.createElement(Card, {
    tone: "glass",
    density: "tight",
    kicker: "Sin precipitaci\xF3n cerca",
    title: place,
    meta: "hace 7 min"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    block: true,
    size: "md",
    onClick: onOpenAlert,
    style: {
      marginTop: 8,
      background: 'rgba(20,22,30,0.06)',
      color: '#14151a'
    }
  }, "Ver ejemplo de alerta"))));
}
window.RadarScreen = RadarScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/plou_app/RadarScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/plou_app/SettingsScreen.jsx
try { (() => {
function SettingsScreen({
  theme,
  onTheme
}) {
  const {
    SegmentedControl,
    ChoiceChips,
    SettingsGroup,
    SettingsRow,
    Switch,
    Slider,
    Card
  } = window.PlouDesignSystem_093e07;
  const [lang, setLang] = React.useState('Castellano');
  const [tUnit, setTUnit] = React.useState('°C');
  const [wUnit, setWUnit] = React.useState('km/h');
  const [pUnit, setPUnit] = React.useState('mm');
  const [dUnit, setDUnit] = React.useState('km');
  const [scale, setScale] = React.useState('Original');
  const [baseMap, setBaseMap] = React.useState('Según el sistema');
  const [history, setHistory] = React.useState('2 h');
  const [opacity, setOpacity] = React.useState(100);
  const [speed, setSpeed] = React.useState(420);
  const [mm, setMm] = React.useState(true);
  const [awake, setAwake] = React.useState(false);
  const [saver, setSaver] = React.useState(false);
  const [extrapolate, setExtrapolate] = React.useState(true);
  const [smooth, setSmooth] = React.useState(true);
  const [snow, setSnow] = React.useState(true);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "plou-eyebrow",
    style: {
      marginBottom: 8
    }
  }, "Idioma"), /*#__PURE__*/React.createElement(SegmentedControl, {
    block: true,
    size: "mobile",
    options: ['Castellano', 'Català', 'English'],
    value: lang,
    onChange: setLang
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "plou-eyebrow",
    style: {
      marginBottom: 8
    }
  }, "Tema"), /*#__PURE__*/React.createElement(SegmentedControl, {
    block: true,
    size: "mobile",
    options: ['Sistema', 'Claro', 'Oscuro'],
    value: theme,
    onChange: onTheme
  })), /*#__PURE__*/React.createElement(SettingsGroup, {
    title: "Unidades",
    density: "mobile"
  }, /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Temperatura",
    inline: true
  }, /*#__PURE__*/React.createElement(SegmentedControl, {
    size: "mobile",
    options: ['°C', '°F'],
    value: tUnit,
    onChange: setTUnit,
    style: {
      width: 110
    }
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Viento"
  }, /*#__PURE__*/React.createElement(ChoiceChips, {
    size: "sm",
    options: ['km/h', 'm/s', 'mph', 'kn', 'Bft'],
    value: wUnit,
    onChange: setWUnit
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Precipitaci\xF3n",
    inline: true
  }, /*#__PURE__*/React.createElement(SegmentedControl, {
    size: "mobile",
    options: ['mm', 'in'],
    value: pUnit,
    onChange: setPUnit,
    style: {
      width: 110
    }
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Distancia",
    inline: true
  }, /*#__PURE__*/React.createElement(SegmentedControl, {
    size: "mobile",
    options: ['km', 'mi'],
    value: dUnit,
    onChange: setDUnit,
    style: {
      width: 110
    }
  }))), /*#__PURE__*/React.createElement(SettingsGroup, {
    title: "Aspecto del mapa",
    density: "mobile"
  }, /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Escala de color"
  }, /*#__PURE__*/React.createElement(ChoiceChips, {
    size: "sm",
    options: ['Blanco y negro', 'Original', 'Azul universal', 'Titan', 'The Weather Channel', 'Meteored', 'NEXRAD nivel III', 'Arcoíris (Selex SI)', 'Dark Sky'],
    value: scale,
    onChange: setScale
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Mapa base"
  }, /*#__PURE__*/React.createElement(ChoiceChips, {
    size: "sm",
    options: ['Según el sistema', 'Claro', 'Oscuro', 'OpenStreetMap', 'OpenTopoMap'],
    value: baseMap,
    onChange: setBaseMap
  })), /*#__PURE__*/React.createElement(SettingsRow, null, /*#__PURE__*/React.createElement(Slider, {
    label: "Opacidad",
    valueLabel: opacity + ' %',
    min: 0,
    max: 100,
    value: opacity,
    onChange: setOpacity
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Historia"
  }, /*#__PURE__*/React.createElement(ChoiceChips, {
    size: "sm",
    options: ['30 min', '1 h', '2 h'],
    value: history,
    onChange: setHistory
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Incluir extrapolaci\xF3n (+30 min)",
    inline: true
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: extrapolate,
    onChange: setExtrapolate
  })), /*#__PURE__*/React.createElement(SettingsRow, null, /*#__PURE__*/React.createElement(Slider, {
    label: "Velocidad",
    valueLabel: speed + ' ms',
    min: 100,
    max: 1000,
    step: 20,
    value: speed,
    onChange: setSpeed
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Suavizado",
    inline: true
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: smooth,
    onChange: setSmooth
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Distinguir nieve",
    inline: true
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: snow,
    onChange: setSnow
  }))), /*#__PURE__*/React.createElement(SettingsGroup, {
    title: "Notificaciones",
    note: "Zona horaria: Europe/Madrid",
    density: "mobile"
  }, /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Mostrar intensidad en mm/h",
    inline: true
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: mm,
    onChange: setMm
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Mantener la pantalla encendida",
    inline: true
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: awake,
    onChange: setAwake
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Ahorro de energ\xEDa",
    inline: true
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: saver,
    onChange: setSaver
  }))), /*#__PURE__*/React.createElement(Card, {
    density: "mobile"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 'var(--weight-bold)',
      fontSize: 'var(--text-body)',
      marginBottom: 4
    }
  }, "Fuentes de datos"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 'var(--text-label)',
      color: 'var(--ink-faint)'
    }
  }, "Radar: RainViewer \xB7 Previsi\xF3n: Open-Meteo \xB7 \xA9 Colaboradores de OpenStreetMap")));
}
window.SettingsScreen = SettingsScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/plou_app/SettingsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/plou_web/AlarmsPanel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function AlarmsPanel({
  alarms,
  onEdit,
  onCheck
}) {
  const {
    Button,
    LocationCard,
    Card
  } = window.PlouDesignSystem_093e07;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "plou-eyebrow",
    style: {
      fontSize: 13
    }
  }, "Mis ubicaciones"), /*#__PURE__*/React.createElement(Button, null, "+ A\xF1adir ubicaci\xF3n")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 16
    }
  }, alarms.map(a => /*#__PURE__*/React.createElement(LocationCard, _extends({
    key: a.name
  }, a, {
    notifType: undefined,
    onEdit: onEdit,
    onCheck: onCheck
  })))), /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 'var(--weight-bold)',
      fontSize: 'var(--text-subtitle)',
      marginBottom: 6
    }
  }, "Historial de avisos"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 'var(--text-body-xs)',
      color: 'var(--ink-faint)'
    }
  }, "Todav\xEDa no se ha emitido ning\xFAn aviso.")));
}
window.AlarmsPanel = AlarmsPanel;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/plou_web/AlarmsPanel.jsx", error: String((e && e.message) || e) }); }

// ui_kits/plou_web/ForecastPanel.jsx
try { (() => {
const STATS = [['SENSACIÓN', '30°'], ['HUMEDAD', '32 %'], ['VIENTO', '6 km/h SE'], ['RACHAS', '22 km/h'], ['PRESIÓN', '1018 hPa'], ['NUBOSIDAD', '0 %'], ['VISIBILIDAD', '44 km'], ['ÍNDICE UV', '7.0 · Alto'], ['PUNTO DE ROCÍO', '13°']];
function ForecastPanel({
  place,
  hourly
}) {
  const {
    Card,
    TempReadout,
    StatTile,
    PrecipChart,
    ChartLegend,
    HourlyList,
    Tag
  } = window.PlouDesignSystem_093e07;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.3fr 1fr',
      gap: 22
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 18
    }
  }, /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement(TempReadout, {
    size: "desktop",
    temp: "31\xB0",
    condition: "Despejado",
    place: place
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 12
    }
  }, STATS.map(([l, v]) => /*#__PURE__*/React.createElement(StatTile, {
    key: l,
    size: "desktop",
    label: l,
    value: v
  }))), /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement(PrecipChart, {
    height: 90,
    title: "Precipitaci\xF3n prevista (6 h)",
    data: hourly.map(h => ({
      time: h.time
    }))
  }), /*#__PURE__*/React.createElement(ChartLegend, {
    style: {
      marginTop: 12
    },
    items: [{
      label: 'Precipitación',
      color: 'var(--gradient-brand-2stop)'
    }, {
      label: 'Probabilidad',
      color: 'var(--divider)'
    }]
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 18
    }
  }, /*#__PURE__*/React.createElement(Card, {
    tone: "washWarm",
    kicker: "Pr\xF3xima ventana",
    title: /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 'var(--text-h2)'
      }
    }, "Sin lluvia hasta las 19:40")
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--text-body-xs)',
      color: 'var(--ink-soft)',
      margin: '8px 0 10px'
    }
  }, "Franja despejada estable durante las pr\xF3ximas 6 horas. Buen momento para salir sin paraguas."), /*#__PURE__*/React.createElement(Tag, null, "Se abre en 6h 20min")), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: '8px 20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "plou-eyebrow",
    style: {
      padding: '14px 0 6px'
    }
  }, "Por horas"), /*#__PURE__*/React.createElement(HourlyList, {
    rows: hourly,
    dayLabel: "Lunes \xB7 27 jul",
    showIcon: true,
    showPrecip: true
  }))));
}
window.ForecastPanel = ForecastPanel;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/plou_web/ForecastPanel.jsx", error: String((e && e.message) || e) }); }

// ui_kits/plou_web/PlouWebShell.jsx
try { (() => {
const TITLES = {
  radar: 'Radar',
  prevision: 'Previsión',
  alarmas: 'Alarmas',
  ajustes: 'Ajustes'
};
const HOURLY = [{
  time: '13:00',
  temp: '31°',
  wind: '5 km/h SE',
  cond: 'Despejado'
}, {
  time: '14:00',
  temp: '31°',
  wind: '6 km/h ESE',
  cond: 'Despejado'
}, {
  time: '15:00',
  temp: '33°',
  wind: '8 km/h SE',
  cond: 'Despejado'
}, {
  time: '16:00',
  temp: '33°',
  wind: '24 km/h SE',
  cond: 'Despejado'
}, {
  time: '17:00',
  temp: '32°',
  wind: '18 km/h SE',
  cond: 'Despejado'
}, {
  time: '18:00',
  temp: '30°',
  wind: '14 km/h S',
  cond: 'Despejado'
}];
const ALARMS = [{
  name: 'Cornellà del Terri',
  status: 'Alarma activa',
  meta: '20 km',
  intensity: 'Débil',
  schedule: 'Todo el día',
  notice: 'Sin avisos todavía',
  dot: 'var(--dot-1)'
}, {
  name: 'Casa — Navata',
  status: 'Alarma activa',
  meta: '10 km',
  intensity: 'Moderada',
  schedule: 'Día',
  notice: 'Sin avisos todavía',
  dot: 'var(--dot-2)'
}, {
  name: 'Trabajo — Figueres',
  status: 'En pausa',
  meta: '15 km',
  intensity: 'Fuerte',
  schedule: 'Noche',
  notice: 'Última alerta hace 3 días',
  dot: 'var(--dot-3)'
}];
function PlouWeb() {
  const {
    Sidebar,
    RadarPanel,
    ForecastPanel,
    AlarmsPanel,
    SettingsPanel
  } = window;
  const {
    Dialog,
    AlertScreen,
    Button,
    TextField,
    SegmentedControl
  } = window.PlouDesignSystem_093e07;
  const [tab, setTab] = React.useState('radar');
  const [themePick, setThemePick] = React.useState('Claro');
  const [playing, setPlaying] = React.useState(true);
  const [alert, setAlert] = React.useState(false);
  const [edit, setEdit] = React.useState(false);
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = themePick === 'Sistema' ? prefersDark ? 'dark' : 'light' : themePick === 'Oscuro' ? 'dark' : 'light';
  const place = 'Navata';
  return /*#__PURE__*/React.createElement("div", {
    "data-theme": theme,
    "data-accent": "mono-warm",
    style: {
      position: 'relative',
      minHeight: '100vh',
      background: 'var(--page-bg)',
      color: 'var(--ink)',
      fontFamily: 'var(--font-sans)',
      display: 'flex',
      justifyContent: 'center',
      padding: 28,
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      maxWidth: 'var(--content-max)',
      display: 'grid',
      gridTemplateColumns: 'var(--sidebar-width) 1fr',
      gap: 28
    }
  }, /*#__PURE__*/React.createElement(Sidebar, {
    tab: tab,
    onTab: setTab,
    theme: themePick,
    onTheme: setThemePick,
    place: place,
    alarms: ALARMS,
    onOpenAlert: () => setAlert(true)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 10,
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 'var(--weight-black)',
      fontSize: 'var(--text-section)'
    }
  }, TITLES[tab]), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-body)',
      color: 'var(--ink-soft)'
    }
  }, "\xB7 ", place)), tab === 'radar' ? /*#__PURE__*/React.createElement(RadarPanel, {
    playing: playing,
    onTogglePlay: () => setPlaying(p => !p)
  }) : null, tab === 'prevision' ? /*#__PURE__*/React.createElement(ForecastPanel, {
    place: place,
    hourly: HOURLY
  }) : null, tab === 'alarmas' ? /*#__PURE__*/React.createElement(AlarmsPanel, {
    alarms: ALARMS,
    onEdit: () => setEdit(true),
    onCheck: () => setAlert(true)
  }) : null, tab === 'ajustes' ? /*#__PURE__*/React.createElement(SettingsPanel, null) : null)), alert ? /*#__PURE__*/React.createElement(AlertScreen, {
    size: "desktop",
    place: place,
    headline: "Lluvia moderada en 12 min",
    detail: 'Procedente del suroeste, hacia ' + place,
    time: "12:00",
    intensity: 0,
    style: {
      position: 'fixed'
    },
    actions: /*#__PURE__*/React.createElement(Button, {
      variant: "onAlert",
      onClick: () => setAlert(false),
      style: {
        margin: '0 auto'
      }
    }, "Silenciar")
  }) : null, edit ? /*#__PURE__*/React.createElement(Dialog, {
    title: "Editar alarma",
    onClose: () => setEdit(false),
    style: {
      position: 'relative'
    },
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      block: true,
      onClick: () => setEdit(false)
    }, "Cancelar"), /*#__PURE__*/React.createElement(Button, {
      block: true,
      onClick: () => setEdit(false)
    }, "Guardar"))
  }, /*#__PURE__*/React.createElement(TextField, {
    label: "Nombre de la ubicaci\xF3n",
    defaultValue: "Cornell\xE0 del Terri"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-tag)',
      color: 'var(--ink-soft)',
      marginBottom: 5
    }
  }, "Intensidad m\xEDnima"), /*#__PURE__*/React.createElement(SegmentedControl, {
    block: true,
    options: ['Débil', 'Moderada', 'Fuerte'],
    value: "D\xE9bil"
  }))) : null);
}
window.PlouWeb = PlouWeb;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/plou_web/PlouWebShell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/plou_web/RadarPanel.jsx
try { (() => {
function RadarPanel({
  playing,
  onTogglePlay
}) {
  const {
    RadarViewport,
    GlassBar,
    TextField,
    Button,
    IconButton,
    Icon,
    Slider,
    MapControls,
    ZoomControl
  } = window.PlouDesignSystem_093e07;
  return /*#__PURE__*/React.createElement(RadarViewport, {
    image: "../../assets/radar-map-tile.png",
    radius: 260,
    style: {
      height: 'calc(100vh - 140px)',
      minHeight: 640
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 20,
      left: 20,
      display: 'flex',
      gap: 10,
      zIndex: 2
    }
  }, /*#__PURE__*/React.createElement(TextField, {
    tone: "glass",
    shape: "pill",
    placeholder: "Buscar lugar\u2026",
    style: {
      width: 300,
      flex: 'none'
    }
  }), /*#__PURE__*/React.createElement(Button, null, "+ Vigilar este punto")), /*#__PURE__*/React.createElement(ZoomControl, {
    style: {
      position: 'absolute',
      left: 20,
      top: 84,
      zIndex: 2
    }
  }), /*#__PURE__*/React.createElement(MapControls, {
    style: {
      position: 'absolute',
      left: 20,
      bottom: 88,
      zIndex: 2
    },
    items: [{
      label: 'Leyenda'
    }]
  }), /*#__PURE__*/React.createElement(MapControls, {
    style: {
      position: 'absolute',
      right: 20,
      bottom: 88,
      zIndex: 2
    },
    items: [{
      label: 'Capas',
      glyph: 'layers'
    }]
  }), /*#__PURE__*/React.createElement(GlassBar, {
    style: {
      position: 'absolute',
      left: 20,
      right: 20,
      bottom: 20,
      gap: 14,
      padding: '10px 16px',
      zIndex: 2
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    tone: "gradient",
    size: 38,
    label: playing ? 'Pausar' : 'Reproducir',
    onClick: onTogglePlay
  }, /*#__PURE__*/React.createElement(Icon, {
    name: playing ? 'pause' : 'play',
    size: 13
  })), /*#__PURE__*/React.createElement(Slider, {
    value: 70,
    onChange: () => {}
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right',
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 900,
      fontSize: 14
    }
  }, "11:40"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--glass-text-faint)'
    }
  }, "\u2212120 min"))));
}
window.RadarPanel = RadarPanel;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/plou_web/RadarPanel.jsx", error: String((e && e.message) || e) }); }

// ui_kits/plou_web/SettingsPanel.jsx
try { (() => {
function SettingsPanel() {
  const {
    Card,
    SegmentedControl,
    ChoiceChips,
    SettingsGroup,
    SettingsRow,
    Switch,
    Slider
  } = window.PlouDesignSystem_093e07;
  const [lang, setLang] = React.useState('Castellano');
  const [tUnit, setTUnit] = React.useState('°C');
  const [wUnit, setWUnit] = React.useState('km/h');
  const [pUnit, setPUnit] = React.useState('mm');
  const [dUnit, setDUnit] = React.useState('km');
  const [prUnit, setPrUnit] = React.useState('hPa');
  const [scale, setScale] = React.useState('Original');
  const [baseMap, setBaseMap] = React.useState('Según el sistema');
  const [history, setHistory] = React.useState('2 h');
  const [opacity, setOpacity] = React.useState(100);
  const [speed, setSpeed] = React.useState(420);
  const [mm, setMm] = React.useState(true);
  const [awake, setAwake] = React.useState(false);
  const [saver, setSaver] = React.useState(false);
  const [extrapolate, setExtrapolate] = React.useState(true);
  const [smooth, setSmooth] = React.useState(true);
  const [snow, setSnow] = React.useState(true);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 20,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(SettingsGroup, {
    title: "Idioma"
  }, /*#__PURE__*/React.createElement(SettingsRow, null, /*#__PURE__*/React.createElement(SegmentedControl, {
    block: true,
    options: ['Castellano', 'Català', 'English'],
    value: lang,
    onChange: setLang
  }))), /*#__PURE__*/React.createElement(SettingsGroup, {
    title: "Unidades"
  }, /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Temperatura",
    inline: true
  }, /*#__PURE__*/React.createElement(SegmentedControl, {
    options: ['°C', '°F'],
    value: tUnit,
    onChange: setTUnit,
    style: {
      width: 110
    }
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Viento"
  }, /*#__PURE__*/React.createElement(ChoiceChips, {
    size: "sm",
    options: ['km/h', 'm/s', 'mph', 'kn', 'Bft'],
    value: wUnit,
    onChange: setWUnit
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Precipitaci\xF3n",
    inline: true
  }, /*#__PURE__*/React.createElement(SegmentedControl, {
    options: ['mm', 'in'],
    value: pUnit,
    onChange: setPUnit,
    style: {
      width: 110
    }
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Distancia",
    inline: true
  }, /*#__PURE__*/React.createElement(SegmentedControl, {
    options: ['km', 'mi'],
    value: dUnit,
    onChange: setDUnit,
    style: {
      width: 110
    }
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Presi\xF3n"
  }, /*#__PURE__*/React.createElement(ChoiceChips, {
    size: "sm",
    options: ['hPa', 'inHg', 'mmHg'],
    value: prUnit,
    onChange: setPrUnit
  }))), /*#__PURE__*/React.createElement(SettingsGroup, {
    title: "Aspecto del mapa",
    style: {
      gridColumn: '1 / -1'
    }
  }, /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Escala de color"
  }, /*#__PURE__*/React.createElement(ChoiceChips, {
    options: ['Blanco y negro', 'Original', 'Azul universal', 'Titan', 'The Weather Channel', 'Meteored', 'NEXRAD nivel III', 'Arcoíris (Selex SI)', 'Dark Sky'],
    value: scale,
    onChange: setScale
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Mapa base"
  }, /*#__PURE__*/React.createElement(ChoiceChips, {
    options: ['Según el sistema', 'Claro', 'Oscuro', 'OpenStreetMap', 'OpenTopoMap'],
    value: baseMap,
    onChange: setBaseMap
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Historia"
  }, /*#__PURE__*/React.createElement(ChoiceChips, {
    size: "sm",
    options: ['30 min', '1 h', '2 h'],
    value: history,
    onChange: setHistory
  })), /*#__PURE__*/React.createElement(SettingsRow, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 24
    }
  }, /*#__PURE__*/React.createElement(Slider, {
    label: "Opacidad",
    valueLabel: opacity + ' %',
    min: 0,
    max: 100,
    value: opacity,
    onChange: setOpacity
  }), /*#__PURE__*/React.createElement(Slider, {
    label: "Velocidad",
    valueLabel: speed + ' ms',
    min: 100,
    max: 1000,
    step: 20,
    value: speed,
    onChange: setSpeed
  }))), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Incluir extrapolaci\xF3n (+30 min)",
    inline: true
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: extrapolate,
    onChange: setExtrapolate
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Suavizado",
    inline: true
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: smooth,
    onChange: setSmooth
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Distinguir nieve",
    inline: true
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: snow,
    onChange: setSnow
  }))), /*#__PURE__*/React.createElement(SettingsGroup, {
    title: "Notificaciones",
    note: "Zona horaria: Europe/Madrid",
    style: {
      gridColumn: '1 / -1'
    }
  }, /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Mostrar intensidad en mm/h",
    inline: true
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: mm,
    onChange: setMm
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Mantener la pantalla encendida",
    inline: true
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: awake,
    onChange: setAwake
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    label: "Ahorro de energ\xEDa",
    inline: true
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: saver,
    onChange: setSaver
  }))), /*#__PURE__*/React.createElement(Card, {
    style: {
      gridColumn: '1 / -1'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 'var(--weight-bold)',
      fontSize: 'var(--text-subtitle)',
      marginBottom: 4
    }
  }, "Fuentes de datos"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 'var(--text-body-xs)',
      color: 'var(--ink-faint)'
    }
  }, "Radar: RainViewer \xB7 Previsi\xF3n: Open-Meteo \xB7 \xA9 Colaboradores de OpenStreetMap")));
}
window.SettingsPanel = SettingsPanel;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/plou_web/SettingsPanel.jsx", error: String((e && e.message) || e) }); }

// ui_kits/plou_web/Sidebar.jsx
try { (() => {
const NAV = [{
  value: 'radar',
  label: 'Radar',
  icon: 'radar'
}, {
  value: 'prevision',
  label: 'Previsión',
  icon: 'forecast'
}, {
  value: 'alarmas',
  label: 'Alarmas',
  icon: 'bell'
}, {
  value: 'ajustes',
  label: 'Ajustes',
  icon: 'settings'
}];
function Sidebar({
  tab,
  onTab,
  theme,
  onTheme,
  place,
  alarms,
  onOpenAlert
}) {
  const {
    Wordmark,
    NavItem,
    Icon,
    SegmentedControl,
    Card,
    Button
  } = window.PlouDesignSystem_093e07;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--sidebar-bg)',
      backdropFilter: 'var(--blur-sidebar)',
      border: '1px solid var(--card-border)',
      borderRadius: 'var(--radius-panel)',
      padding: '24px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      height: 'fit-content',
      position: 'sticky',
      top: 28
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 12px 20px'
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    size: 24
  })), NAV.map(n => /*#__PURE__*/React.createElement(NavItem, {
    key: n.value,
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: n.icon,
      size: 19
    }),
    active: tab === n.value,
    onClick: () => onTab(n.value)
  }, n.label)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      paddingTop: 16,
      borderTop: '1px solid var(--divider)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "plou-eyebrow",
    style: {
      fontSize: 11,
      color: 'var(--ink-faint)',
      padding: '0 12px 8px'
    }
  }, "Tema"), /*#__PURE__*/React.createElement(SegmentedControl, {
    block: true,
    size: "sm",
    options: ['Sistema', 'Claro', 'Oscuro'],
    value: theme,
    onChange: onTheme
  })), tab === 'radar' ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      paddingTop: 16,
      borderTop: '1px solid var(--divider)',
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Card, {
    tone: "washCool",
    density: "tight",
    kicker: "Sin precipitaci\xF3n cerca",
    title: place,
    meta: "hace 7 min"
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--text-label)',
      color: 'var(--ink-soft)',
      margin: '8px 0 10px'
    }
  }, "No se espera precipitaci\xF3n (0\u201390 min)."), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    block: true,
    size: "sm",
    onClick: onOpenAlert
  }, "Ver ejemplo de alerta")), /*#__PURE__*/React.createElement(Card, {
    density: "tight"
  }, /*#__PURE__*/React.createElement("div", {
    className: "plou-eyebrow",
    style: {
      fontSize: 10.5,
      marginBottom: 10
    }
  }, "Mis ubicaciones"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, alarms.map((a, i) => /*#__PURE__*/React.createElement("div", {
    key: a.name,
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px 0',
      borderBottom: i === alarms.length - 1 ? 'none' : '1px solid var(--divider-soft)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: a.dot
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      fontWeight: 600
    }
  }, a.name)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10.5,
      color: 'var(--ink-faint)'
    }
  }, a.meta)))))) : null);
}
window.Sidebar = Sidebar;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/plou_web/Sidebar.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.PLOU_ICONS = __ds_scope.PLOU_ICONS;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Wordmark = __ds_scope.Wordmark;

__ds_ns.AlertScreen = __ds_scope.AlertScreen;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.GlassBar = __ds_scope.GlassBar;

__ds_ns.ChoiceChips = __ds_scope.ChoiceChips;

__ds_ns.SegmentedControl = __ds_scope.SegmentedControl;

__ds_ns.SettingsGroup = __ds_scope.SettingsGroup;

__ds_ns.SettingsRow = __ds_scope.SettingsRow;

__ds_ns.Slider = __ds_scope.Slider;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.TextField = __ds_scope.TextField;

__ds_ns.NavItem = __ds_scope.NavItem;

__ds_ns.TabBar = __ds_scope.TabBar;

__ds_ns.ChartLegend = __ds_scope.ChartLegend;

__ds_ns.HourlyList = __ds_scope.HourlyList;

__ds_ns.LocationCard = __ds_scope.LocationCard;

__ds_ns.MapControls = __ds_scope.MapControls;

__ds_ns.ZoomControl = __ds_scope.ZoomControl;

__ds_ns.PrecipChart = __ds_scope.PrecipChart;

__ds_ns.RadarViewport = __ds_scope.RadarViewport;

__ds_ns.StatTile = __ds_scope.StatTile;

__ds_ns.TempReadout = __ds_scope.TempReadout;

})();
