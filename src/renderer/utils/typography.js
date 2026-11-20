/**
 * Fonts and text sizes offered in the editor.
 *
 * Fonts are applied to selected text as a class (`ql-font-<id>`), so a
 * saved note only ever contains these ids — never a free-form font name —
 * and editor.css maps each id to its font stack. The bundled fonts live in
 * vendor/fonts (no downloads; notes look the same on every computer).
 */

/** Fonts for selected text and for the default in Settings, in menu order */
export const FONTS = [
  { id: 'serif', label: 'Serif', stack: "Charter, 'Bitstream Charter', 'Iowan Old Style', Georgia, Cambria, 'Times New Roman', serif" },
  { id: 'sans', label: 'Sans', stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Segoe UI Variable', Roboto, Helvetica, Arial, sans-serif" },
  { id: 'inter', label: 'Inter', stack: "'NeatNote Inter', -apple-system, 'Segoe UI', sans-serif" },
  { id: 'nunito', label: 'Nunito', stack: "'NeatNote Nunito', -apple-system, 'Segoe UI', sans-serif" },
  { id: 'lora', label: 'Lora', stack: "'NeatNote Lora', Georgia, serif" },
  { id: 'merriweather', label: 'Merriweather', stack: "'NeatNote Merriweather', Georgia, serif" },
  { id: 'garamond', label: 'EB Garamond', stack: "'NeatNote EB Garamond', Garamond, Georgia, serif" },
  { id: 'atkinson', label: 'Atkinson Hyperlegible', stack: "'NeatNote Atkinson Hyperlegible', -apple-system, 'Segoe UI', sans-serif" },
  { id: 'mono', label: 'JetBrains Mono', stack: "'NeatNote JetBrains Mono', ui-monospace, Menlo, Consolas, monospace" },
  { id: 'caveat', label: 'Caveat (handwriting)', stack: "'NeatNote Caveat', 'Segoe Print', 'Bradley Hand', cursive" }
];

/** The note font when nothing else is chosen (matches the 1.x look) */
export const DEFAULT_FONT = 'serif';

/**
 * Sizes for selected text, as written into the note (an inline
 * font-size). "Normal" — no size at all — sits between 14 and 18 in the
 * menu and follows the default size from Settings.
 */
export const TEXT_SIZES = ['12px', '14px', '18px', '20px', '24px', '28px', '32px', '40px'];

/** Default text size choices in Settings */
export const DEFAULT_SIZES = [
  { id: 'small', label: 'Small', value: '14.5px' },
  { id: 'normal', label: 'Normal', value: '16.5px' },
  { id: 'large', label: 'Large', value: '18.5px' },
  { id: 'xlarge', label: 'Extra large', value: '21px' }
];

const FONT_KEY = 'neatnote-editor-font';
const SIZE_KEY = 'neatnote-editor-size';

/** @returns {{font: string, size: string}} The saved defaults (always valid) */
export function loadTypographyDefaults() {
  let font = DEFAULT_FONT;
  let size = 'normal';
  try {
    const savedFont = localStorage.getItem(FONT_KEY);
    const savedSize = localStorage.getItem(SIZE_KEY);
    if (FONTS.some((f) => f.id === savedFont)) font = savedFont;
    if (DEFAULT_SIZES.some((s) => s.id === savedSize)) size = savedSize;
  } catch (error) {
    // Defaults
  }
  return { font, size };
}

/**
 * Apply the default note font and size (CSS variables read by editor.css).
 * @param {{font?: string, size?: string}} choice
 */
export function applyTypographyDefaults({ font, size } = loadTypographyDefaults()) {
  const fontEntry = FONTS.find((f) => f.id === font) || FONTS.find((f) => f.id === DEFAULT_FONT);
  const sizeEntry = DEFAULT_SIZES.find((s) => s.id === size) || DEFAULT_SIZES[1];
  const root = document.documentElement.style;
  root.setProperty('--editor-font', fontEntry.stack);
  root.setProperty('--editor-size', sizeEntry.value);
}

/**
 * Save and apply the default note font and/or size.
 * @param {{font?: string, size?: string}} choice
 */
export function saveTypographyDefaults(choice) {
  const current = loadTypographyDefaults();
  const next = { ...current, ...choice };
  try {
    localStorage.setItem(FONT_KEY, next.font);
    localStorage.setItem(SIZE_KEY, next.size);
  } catch (error) {
    console.error('Could not save the default font:', error);
  }
  applyTypographyDefaults(next);
}
