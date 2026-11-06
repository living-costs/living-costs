// Classic script, run before the first paint: apply a saved light or dark choice so the page
// does not flash the wrong theme. No saved choice means auto (the OS and browser decide), so the
// stylesheet needs nothing set. The key is the same as THEME_KEY in ui/theme.js.
try {
  const saved = localStorage.getItem('living-costs-theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch { /* storage blocked: stay on auto */ }
