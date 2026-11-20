/**
 * SVG icons for the rich text editor toolbar.
 * All icons are 24x24, drawn with `currentColor` so they follow the
 * active theme automatically (including hover/active accent states).
 */

const stroke = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const filled = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">${inner}</svg>`;

const headingText = (label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><text x="12" y="16.5" text-anchor="middle" font-size="13" font-weight="700" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" fill="currentColor">${label}</text></svg>`;

export const toolbarIcons = {
  bold: stroke(
    `<path d="M7 4.5h5.5a3.25 3.25 0 0 1 0 6.5H7zM7 11h6.25a3.25 3.25 0 0 1 0 6.5H7z"/>`
  ),

  italic: stroke(
    `<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>`
  ),

  underline: stroke(
    `<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="5" y1="20" x2="19" y2="20"/>`
  ),

  strike: stroke(
    `<path d="M16.5 6.5c-.9-1.2-2.5-2-4.5-2-2.6 0-4.5 1.4-4.5 3.4 0 1.1.5 1.9 1.5 2.6"/><path d="M8 17.2c.9 1.4 2.5 2.3 4.5 2.3 2.7 0 4.6-1.4 4.6-3.6 0-.8-.2-1.4-.7-2"/><line x1="4" y1="12" x2="20" y2="12"/>`
  ),

  header1: headingText('H1'),
  header2: headingText('H2'),
  header3: headingText('H3'),

  bulletList: stroke(
    `<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>`
  ),

  orderedList: stroke(
    `<line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><path d="M4 5l1.5-1v4" stroke-width="1.5"/><path d="M3.6 10.8c.3-.6 1-.9 1.7-.7.7.2 1 .9.7 1.5L3.5 14h3" stroke-width="1.5"/><path d="M3.5 16.5h2a1.1 1.1 0 0 1 0 2.2H4.6h.9a1.1 1.1 0 0 1 0 2.2h-2" stroke-width="1.5"/>`
  ),

  blockquote: filled(
    `<path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>`
  ),

  codeBlock: stroke(
    `<rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="9.5 9 7 12 9.5 15"/><polyline points="14.5 9 17 12 14.5 15"/>`
  ),

  inlineCode: stroke(
    `<polyline points="8.5 7 4 12 8.5 17"/><polyline points="15.5 7 20 12 15.5 17"/>`
  ),

  horizontalRule: stroke(
    `<line x1="4" y1="12" x2="20" y2="12"/><line x1="7" y1="6.5" x2="17" y2="6.5" opacity="0.35"/><line x1="7" y1="17.5" x2="17" y2="17.5" opacity="0.35"/>`
  ),

  link: stroke(
    `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`
  ),

  undo: stroke(
    `<polyline points="9 14 4 9 9 4"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>`
  ),

  redo: stroke(
    `<polyline points="15 14 20 9 15 4"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>`
  ),

  // "T" with a strike-out mark: remove formatting from the selection
  clearFormat: stroke(
    `<path d="M5 6V4.5h11V6"/><line x1="10.5" y1="4.5" x2="8.5" y2="19.5"/><line x1="6" y1="19.5" x2="11" y2="19.5"/><line x1="15" y1="14" x2="20.5" y2="19.5"/><line x1="20.5" y1="14" x2="15" y2="19.5"/>`
  ),

  checkList: stroke(
    `<rect x="3.5" y="4.5" width="6" height="6" rx="1.5"/><polyline points="4.8 7.6 6.2 9 8.4 6"/><rect x="3.5" y="13.5" width="6" height="6" rx="1.5"/><line x1="13" y1="7.5" x2="21" y2="7.5"/><line x1="13" y1="16.5" x2="21" y2="16.5"/>`
  ),

  image: stroke(
    `<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M21 15.5l-5-5-8.5 9"/>`
  ),

  table: stroke(
    `<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="3" y1="14.75" x2="21" y2="14.75"/><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/>`
  ),

  rowAbove: stroke(
    `<rect x="3" y="12" width="18" height="8" rx="1.5"/><line x1="12" y1="3" x2="12" y2="9"/><line x1="9" y1="6" x2="15" y2="6"/>`
  ),

  rowBelow: stroke(
    `<rect x="3" y="4" width="18" height="8" rx="1.5"/><line x1="12" y1="15" x2="12" y2="21"/><line x1="9" y1="18" x2="15" y2="18"/>`
  ),

  colLeft: stroke(
    `<rect x="12" y="3" width="8" height="18" rx="1.5"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="6" y1="9" x2="6" y2="15"/>`
  ),

  colRight: stroke(
    `<rect x="4" y="3" width="8" height="18" rx="1.5"/><line x1="15" y1="12" x2="21" y2="12"/><line x1="18" y1="9" x2="18" y2="15"/>`
  ),

  deleteRow: stroke(
    `<rect x="3" y="8" width="18" height="8" rx="1.5"/><line x1="10" y1="10" x2="14" y2="14"/><line x1="14" y1="10" x2="10" y2="14"/>`
  ),

  deleteCol: stroke(
    `<rect x="8" y="3" width="8" height="18" rx="1.5"/><line x1="10" y1="10" x2="14" y2="14"/><line x1="14" y1="10" x2="10" y2="14"/>`
  ),

  deleteTable: stroke(
    `<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>`
  ),

  textStyle: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><text x="1.5" y="17.5" font-size="15" font-weight="600" font-family="Georgia, 'Times New Roman', serif" fill="currentColor">A</text><text x="12.5" y="17.5" font-size="11" font-weight="600" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" fill="currentColor">a</text></svg>`,
};
