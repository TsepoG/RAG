// @ts-check

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const VIEW_BOX = '0 0 24 24';
const DEFAULT_SIZE = 16;
const DEFAULT_STROKE_WIDTH = 2;

/**
 * The icons, each as the paths of a 24 by 24 drawing, taken from the approved design.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
const PATHS = Object.freeze({
  check: ['M5 12l5 5 9-10'],
});

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
