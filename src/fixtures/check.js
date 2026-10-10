// @ts-check

/**
 * What a leak check looks for in sanitised output, besides the fixed patterns.
 * @typedef {object} LeakCheckInput
 * @property {ReadonlyArray<string>} names - Real names that must not appear: the site's name, the
 *   repository owners and names, the space keys. Taken from config, never written in source.
 * @property {ReadonlyArray<string>} replaced - Original strings the sanitiser replaced.
 */

/** Names this short are matched case-sensitively, so a space key like `TS` does not match `ts`. */
const SHORT_NAME_LENGTH = 4;
const EMAIL_LOCAL_CHARACTER = /[\w.+-]/;
// Anchored at the start, so it is matched against the text right after an "@" in linear time.
const EMAIL_DOMAIN = /^(?!example\.com\b)[\w-]+(?:\.[\w-]+)+/;
const EMAIL_DOMAIN_WINDOW = 255;
// Atlassian account ids: 24 hex characters, or `<digits>:<uuid>`.
const ACCOUNT_ID_HEX = /\b[0-9a-f]{24}\b/;
const ACCOUNT_ID_COLON = /\b\d{5,7}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/**
 * Escapes text for use inside a regular expression.
 * @param {string} text - The text.
 * @returns {string} The escaped text.
 */
function escapeRegex(text) {
  return text.replace(REGEX_SPECIALS, String.raw`\$&`);
}

/**
 * Builds a whole-word matcher for a real name.
 * @param {string} name - The name.
 * @returns {RegExp} A matcher that ignores case for names of four or more characters.
 */
function nameMatcher(name) {
  const flags = name.length >= SHORT_NAME_LENGTH ? 'i' : '';
  return new RegExp(String.raw`(?<![\w-])${escapeRegex(name)}(?![\w-])`, flags);
}

/**
 * Collects the string values of JSON text, including JSON held inside strings, one per line. Keys
 * are left out: they are structure, and a word that is also a key is not a leaked value.
 * @param {string} output - The sanitised fixture as text; text that is not JSON is used as it is.
 * @returns {string} The values, one per line.
 */
function valueText(output) {
  try {
    return collectStrings(JSON.parse(output)).join('\n');
  } catch {
    return output;
  }
}

/**
 * Gathers every string in a JSON value, looking inside strings that hold JSON.
 * @param {unknown} value - The value.
 * @returns {string[]} The strings.
 */
function collectStrings(value) {
  if (typeof value === 'string') {
    try {
      return collectStrings(JSON.parse(value));
    } catch {
      return [value];
    }
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectStrings);
  }
  return value !== null && typeof value === 'object'
    ? Object.values(value).flatMap(collectStrings)
    : [];
}

/**
 * Whether an original string is still in the values as a token of its own. Inside a longer token
 * it does not count: a dotfile named .github is not leaked by the host api.github.com.
 * @param {string} values - The values from {@link valueText}.
 * @param {string} original - The original string.
 * @returns {boolean} True when it survives.
 */
function survivesIn(values, original) {
  return new RegExp(String.raw`(?<![\w-])${escapeRegex(original)}(?![\w-])`).test(values);
}

/**
 * Whether the text holds an email address on a domain other than the placeholder one. It looks at
 * each "@" instead of using one pattern, which would be slow on long text.
 * @param {string} text - The text.
 * @returns {boolean} True when an email address is found.
 */
function containsEmail(text) {
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    const hasLocalPart = at > 0 && EMAIL_LOCAL_CHARACTER.test(text[at - 1]);
    if (hasLocalPart && EMAIL_DOMAIN.test(text.slice(at + 1, at + 1 + EMAIL_DOMAIN_WINDOW))) {
      return true;
    }
  }
  return false;
}

/**
 * Looks for anything in sanitised output that could identify the organisation or a person. The
 * findings name the kind of problem, never the value, so the check cannot leak what it finds.
 * @param {string} output - The sanitised fixture as text.
 * @param {LeakCheckInput} input - The names and replaced strings to look for.
 * @returns {string[]} One entry per kind of leak found; empty when the output is clean.
 */
export function findForbiddenContent(output, { names, replaced }) {
  const findings = [];
  if (names.some((name) => name !== '' && nameMatcher(name).test(output))) {
    findings.push('a configured name (site, owner, repository or space)');
  }
  if (containsEmail(output)) {
    findings.push('an email address');
  }
  if (ACCOUNT_ID_HEX.test(output) || ACCOUNT_ID_COLON.test(output)) {
    findings.push('an Atlassian account id');
  }
  const values = valueText(output);
  if (replaced.some((original) => survivesIn(values, original))) {
    findings.push('an original string that should have been replaced');
  }
  return findings;
}
