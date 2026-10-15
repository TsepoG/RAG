// @ts-check

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const VIEW_BOX = '0 0 24 24';
const DEFAULT_SIZE = 16;
const DEFAULT_STROKE_WIDTH = 2;

/**
 * The icons, each as the paths of a 24 by 24 drawing. Most are taken from the approved design; a
 * circle is drawn as a path of two arcs so every shape is a path.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
const PATHS = Object.freeze({
  check: ['M5 12l5 5 9-10'],
  'alert-circle': ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M12 8v5M12 16.5v.5'],
  'alert-triangle': [
    'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    'M12 9v4M12 17h.01',
  ],
  refresh: ['M21 12a9 9 0 1 1-3-6.7', 'M21 4v5h-5'],
  'search-minus': ['M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'M21 21l-4.3-4.3M8 11h6'],
  'no-entry': ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M5.6 5.6l12.8 12.8'],
  'help-circle': [
    'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0',
    'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7',
    'M12 17h.01',
  ],
  'thumbs-up': [
    'M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.7 21H7',
  ],
  'thumbs-down': [
    'M17 13V4h3v9zM17 13l-4 8a2 2 0 0 1-3-2l1-5H5a2 2 0 0 1-2-2.3l1.3-7A2 2 0 0 1 6.3 3H17',
  ],
});

/** The names of the icons that can be drawn. */
export const ICON_NAMES = Object.freeze(Object.keys(PATHS));

/**
 * Draws an icon. It is always hidden from screen readers: whatever it stands for is also said in
 * words next to it. The shapes are made with DOM calls, never from a string of markup.
 * @param {keyof typeof PATHS} name - Which icon.
 * @param {{ size?: number, strokeWidth?: number }} [options] - Its size in pixels and the thickness of its lines.
 * @returns {SVGElement} The icon.
 */
export function icon(name, { size = DEFAULT_SIZE, strokeWidth = DEFAULT_STROKE_WIDTH } = {}) {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  const attributes = {
    width: String(size),
    height: String(size),
    viewBox: VIEW_BOX,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': String(strokeWidth),
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
    class: `icon icon--${name}`,
  };
  for (const [key, value] of Object.entries(attributes)) {
    svg.setAttribute(key, value);
  }
  for (const data of PATHS[name]) {
    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute('d', data);
    svg.append(path);
  }
  return svg;
}
