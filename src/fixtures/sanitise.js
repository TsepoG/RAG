// @ts-check

/**
 * The real names that must not survive, taken from config by the caller. Placeholders are chosen
 * here, so a fixture never reveals which organisation it came from.
 * @typedef {object} SanitiseLimits
 * @property {string} siteHost - Host of the Atlassian site, for example `acme.atlassian.net`.
 * @property {ReadonlyArray<string>} repos - Repositories as `owner/repo`.
 * @property {ReadonlyArray<string>} spaceKeys - Confluence space keys.
 */

/**
 * Turns raw tool results into fixtures: structure, ids, versions, dates and SHAs stay; every name,
 * text, title, path, person and organisation-specific URL is replaced by a stable placeholder.
 * @typedef {object} Sanitiser
 * @property {(value: unknown) => unknown} sanitise - Returns a sanitised copy of a JSON value.
 * @property {() => string[]} replacedStrings - Every original string that was replaced, so the
 *   output can be checked to hold none of them.
 */

const PLACEHOLDER_SITE_HOST = 'acme.atlassian.net';
const PLACEHOLDER_OWNER = 'acme';
const PLACEHOLDER_REPO = 'app';
const PLACEHOLDER_SPACE = 'ENG';
const PLACEHOLDER_URL = 'https://example.com/placeholder';
const PLACEHOLDER_EMAIL_DOMAIN = 'example.com';
const PUBLIC_HOSTS = new Set(['github.com', 'api.github.com']);
const MIN_ORIGINAL_LENGTH = 6;
const STRING_WITH_JSON = /^\s*[{[]/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?$/;
const SHA = /^[0-9a-f]{40}$/;
const DIGITS = /^\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const ACCOUNT_KEY = /(?:account|author|owner|user|creator)id$/i;
// Only these extensions survive in a placeholder name; any other could be a word from the original.
const KNOWN_EXTENSIONS = new Set([
  '.md',
  '.js',
  '.ts',
  '.py',
  '.json',
  '.yml',
  '.yaml',
  '.txt',
  '.html',
  '.css',
  '.java',
  '.go',
  '.rb',
  '.sql',
  '.toml',
  '.cfg',
  '.ini',
  '.sh',
  '.xml',
  '.cs',
  '.lock',
]);
const URL_START = /^(?:https?:\/\/|repo:\/\/|\/)/i;

// Values under these keys describe the shape of a result, not its content.
const KEPT_KEYS = new Set([
  'type',
  'status',
  'detail',
  'format',
  'mimeType',
  'resultType',
  'entityType',
  'user_view_type',
  'iconCssClass',
  'state',
  'encoding',
  'server',
  'tool',
]);
// Values that are the same in every repository and say nothing about this one.
const KEPT_VALUES = new Set(['main', 'master', 'text', 'file', 'dir', 'page', 'blogpost']);
// Words in a URL that belong to the site's own structure.
const STRUCTURE = new Set([
  'wiki',
  'spaces',
  'pages',
  'blob',
  'tree',
  'raw',
  'sha',
  'contents',
  'releases',
  'tag',
  'download',
  'commit',
  'commits',
  'repos',
  'api',
  'git',
  'trees',
  'blobs',
  'rest',
  'search',
  'content',
  'x',
]);
const PERSON_PARENTS = new Set(['author', 'committer', 'user', 'owner', 'sender', 'creator']);
const PATH_KEYS = new Set(['path', 'filename', 'name']);
const TEXT_LABELS = { title: 'Page title', message: 'Commit message', body: 'Body text' };
const DEFAULT_TEXT_LABEL = 'Placeholder text';

/**
 * Creates a sanitiser. It remembers what it replaced, so the same original always gets the same
 * placeholder, within one file and across all the files of a run.
 * @param {SanitiseLimits} limits - The real site, repositories and spaces.
 * @returns {Sanitiser} The sanitiser.
 */
export function createSanitiser({ siteHost, repos, spaceKeys }) {
  /** @type {Map<string, string>} */
  const memo = new Map();
  /** @type {Map<string, number>} */
  const counters = new Map();
  const replaced = new Set();
  /** @type {Map<string, string>} */
  const named = new Map();

  const remember = (/** @type {string} */ real, /** @type {string} */ placeholder) =>
    named.set(real.toLowerCase(), placeholder);
  remember(siteHost, PLACEHOLDER_SITE_HOST);
  remember(siteHost.split('.')[0], PLACEHOLDER_OWNER);
  repos.forEach((repo, index) => {
    const [owner, name] = repo.split('/');
    const suffix = index === 0 ? '' : `-${index + 1}`;
    remember(owner, PLACEHOLDER_OWNER);
    remember(name, `${PLACEHOLDER_REPO}${suffix}`);
  });
  spaceKeys.forEach((key, index) =>
    remember(key, index === 0 ? PLACEHOLDER_SPACE : `SPACE${index + 1}`),
  );

  /**
   * Gives the same placeholder to the same original, numbering new ones by kind.
   * @param {string} kind - What sort of value it is; each kind has its own numbering.
   * @param {string} real - The original value.
   * @param {(count: number) => string} make - Builds the placeholder from the kind's count.
   * @returns {string} The placeholder.
   */
  function placeholderFor(kind, real, make) {
    const key = `${kind}\u0000${real}`;
    const known = memo.get(key);
    if (known !== undefined) {
      return known;
    }
    const count = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, count);
    const placeholder = make(count);
    memo.set(key, placeholder);
    if (real.length >= MIN_ORIGINAL_LENGTH) {
      replaced.add(real);
    }
    return placeholder;
  }

  /**
   * Replaces one part of a path, keeping its extension.
   * @param {string} part - The original part.
   * @returns {string} The placeholder part.
   */
  function renamePart(part) {
    return placeholderFor('part', part, (n) => `part-${n}${extensionOf(part)}`);
  }

  /**
   * Replaces a path or file name, one part at a time, keeping extensions.
   * @param {string} real - The original path.
   * @returns {string} The placeholder path.
   */
  function sanitisePath(real) {
    return real
      .split('/')
      .map((part) => {
        const mapped = named.get(part.toLowerCase());
        if (mapped !== undefined) {
          return mapped;
        }
        return isKept(part, '') || STRUCTURE.has(part) ? part : renamePart(part);
      })
      .join('/');
  }

  /**
   * Replaces a URL: only the site, GitHub and `repo://` keep a host, and their paths are rewritten.
   * @param {string} real - The original URL or site-relative path.
   * @returns {string} The sanitised URL.
   */
  function sanitiseUrl(real) {
    if (real.length >= MIN_ORIGINAL_LENGTH) {
      replaced.add(real);
    }
    const [beforeQuery] = real.split('?');
    const queryPart = real.includes('?') ? '?placeholder=1' : '';
    const [location] = beforeQuery.split('#');
    const hash = beforeQuery.includes('#') ? '#section' : '';
    const match = /^(https?|repo):\/\/([^/]+)(\/.*)?$/i.exec(location);
    if (match === null) {
      return `${sanitisePath(location)}${hash}${queryPart}`;
    }
    const [, scheme, host, path = ''] = match;
    const isRepoUri = scheme.toLowerCase() === 'repo';
    const mappedHost = isRepoUri ? named.get(host.toLowerCase()) : hostFor(host);
    if (mappedHost === undefined) {
      return PLACEHOLDER_URL;
    }
    return `${scheme}://${mappedHost}${sanitisePath(path)}${hash}${queryPart}`;
  }

  /**
   * Chooses the host a URL may keep.
   * @param {string} host - The original host.
   * @returns {string | undefined} The host to write, or undefined when the URL must be replaced.
   */
  function hostFor(host) {
    const lower = host.toLowerCase();
    if (PUBLIC_HOSTS.has(lower)) {
      return lower;
    }
    return lower === siteHost.toLowerCase() ? PLACEHOLDER_SITE_HOST : undefined;
  }

  /**
   * Replaces a string by what kind of value its key says it is.
   * @param {string} value - The original string.
   * @param {string} key - The key it sits under.
   * @param {string} parent - The key of the object that holds it.
   * @returns {string} The sanitised string.
   */
  function sanitiseString(value, key, parent) {
    if (STRING_WITH_JSON.test(value)) {
      const parsed = tryParse(value);
      if (parsed !== undefined) {
        return JSON.stringify(walk(parsed, key, parent));
      }
    }
    if (isKept(value, key)) {
      return value;
    }
    if (UUID.test(value)) {
      return placeholderFor(
        'uuid',
        value,
        (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      );
    }
    if (EMAIL.test(value)) {
      return placeholderFor('email', value, (n) => `user${n}@${PLACEHOLDER_EMAIL_DOMAIN}`);
    }
    if (ACCOUNT_KEY.test(key)) {
      return placeholderFor('account', value, (n) => `account-${n}`);
    }
    if (PERSON_PARENTS.has(parent)) {
      return sanitisePerson(value, key);
    }
    if (URL_START.test(value)) {
      return sanitiseUrl(value);
    }
    if (PATH_KEYS.has(key)) {
      return sanitisePath(value);
    }
    const label = TEXT_LABELS[/** @type {keyof typeof TEXT_LABELS} */ (key)] ?? DEFAULT_TEXT_LABEL;
    return placeholderFor(`text:${label}`, value, (n) => `${label} ${n}`);
  }

  /**
   * Replaces a field of a person.
   * @param {string} value - The original value.
   * @param {string} key - The field name, such as `login` or `name`.
   * @returns {string} The placeholder.
   */
  function sanitisePerson(value, key) {
    if (URL_START.test(value)) {
      return sanitiseUrl(value);
    }
    return key === 'login'
      ? placeholderFor('login', value, (n) => `user${n}`)
      : placeholderFor('person', value, (n) => `Person ${n}`);
  }

  /**
   * Walks a JSON value, sanitising every string, and every id that identifies a person.
   * @param {unknown} value - The value.
   * @param {string} key - The key it sits under.
   * @param {string} parent - The key of the object that holds it.
   * @returns {unknown} The sanitised copy.
   */
  function walk(value, key, parent) {
    if (typeof value === 'string') {
      return sanitiseString(value, key, parent);
    }
    if (Array.isArray(value)) {
      return value.map((item) => walk(item, key, parent));
    }
    if (typeof value === 'number' && key === 'id' && PERSON_PARENTS.has(parent)) {
      return Number(placeholderFor('person-id', String(value), (n) => String(900_000 + n)));
    }
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([name, item]) => [name, walk(item, name, key)]),
      );
    }
    return value;
  }

  return {
    sanitise: (value) => walk(value, '', ''),
    replacedStrings: () => [...replaced],
  };
}

/**
 * The extension of a file name, with its dot, if it is a well-known one. A name that only starts
 * with a dot, such as a dotfile, has none: the part after the dot is its name.
 * @param {string} name - A file name.
 * @returns {string} The extension, or an empty string.
 */
function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : '';
  return KNOWN_EXTENSIONS.has(extension) ? extension : '';
}

/**
 * Whether a string says nothing about the organisation and stays as it is.
 * @param {string} value - The string.
 * @param {string} key - The key it sits under.
 * @returns {boolean} True when it is kept.
 */
function isKept(value, key) {
  return (
    value === '' ||
    KEPT_KEYS.has(key) ||
    KEPT_VALUES.has(value) ||
    ISO_DATE.test(value) ||
    SHA.test(value) ||
    DIGITS.test(value)
  );
}

/**
 * Parses JSON text, giving up quietly when it is not JSON after all.
 * @param {string} text - The text.
 * @returns {unknown} The value, or undefined when the text is not JSON.
 */
function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
