export const BRAND_THEMES = [
  { key: 'lime', label: 'Lime', primary: '#ccff00', hover: '#b3e600', rgb: '204 255 0' },
  { key: 'blue', label: 'Azul', primary: '#3b82f6', hover: '#2563eb', rgb: '59 130 246' },
  { key: 'emerald', label: 'Esmeralda', primary: '#10b981', hover: '#059669', rgb: '16 185 129' },
  { key: 'amber', label: 'Amber', primary: '#f59e0b', hover: '#d97706', rgb: '245 158 11' },
  { key: 'rose', label: 'Rose', primary: '#f43f5e', hover: '#e11d48', rgb: '244 63 94' },
];

const DEFAULT_THEME_KEY = 'lime';
const BRANDING_STORAGE_KEY = 'gymbro_branding';

export function getThemeByKey(themeKey) {
  return BRAND_THEMES.find((item) => item.key === themeKey) || BRAND_THEMES[0];
}

export function normalizeBranding(input) {
  const branding = input || {};
  const theme = getThemeByKey(branding.theme_key || DEFAULT_THEME_KEY);
  return {
    theme_key: theme.key,
    logo_data_url: branding.logo_data_url || null,
  };
}

export function applyBrandingToDocument(input) {
  if (typeof document === 'undefined') return;
  const branding = normalizeBranding(input);
  const theme = getThemeByKey(branding.theme_key);
  const root = document.documentElement;
  root.style.setProperty('--brand-primary', theme.primary);
  root.style.setProperty('--brand-primary-hover', theme.hover);
  root.style.setProperty('--brand-primary-rgb', theme.rgb);
}

export function saveBranding(input) {
  if (typeof localStorage === 'undefined') return;
  const branding = normalizeBranding(input);
  localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(branding));
}

export function loadBranding() {
  if (typeof localStorage === 'undefined') return normalizeBranding({});
  const raw = localStorage.getItem(BRANDING_STORAGE_KEY);
  if (!raw) return normalizeBranding({});
  try {
    return normalizeBranding(JSON.parse(raw));
  } catch {
    return normalizeBranding({});
  }
}
