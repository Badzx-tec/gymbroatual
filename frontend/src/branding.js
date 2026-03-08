export const BRAND_THEMES = [
  { key: 'lime', label: 'Lima', primary: '#c8f169', hover: '#b4dd56', rgb: '200 241 105' },
  { key: 'blue', label: 'Azul', primary: '#60a5fa', hover: '#3b82f6', rgb: '96 165 250' },
  { key: 'emerald', label: 'Esmeralda', primary: '#34d399', hover: '#10b981', rgb: '52 211 153' },
  { key: 'amber', label: 'Amber', primary: '#fbbf24', hover: '#f59e0b', rgb: '251 191 36' },
  { key: 'rose', label: 'Rose', primary: '#fb7185', hover: '#f43f5e', rgb: '251 113 133' },
];

const DEFAULT_THEME_KEY = 'lime';
const BRANDING_STORAGE_KEY = 'gymbro_branding';
export const APP_BRAND = {
  name: 'GymBro',
  shortName: 'GB',
  tagline: 'Performance operacional para academias',
  productLine: 'Gestao, acesso e recorrencia em uma unica operacao.',
};

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
