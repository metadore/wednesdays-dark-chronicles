/**
 * Pagination parsing.
 *
 * The public list endpoints accept `page` and `limit` as query parameters.
 * They are attacker-controlled strings, so they have to be parsed defensively
 * before they reach the database.
 *
 * The contract the API has always had (and that the existing test suite
 * asserts) is that an invalid pagination parameter is handled GRACEFULLY:
 * the request still succeeds and the value falls back to its default. A
 * visitor who follows a link with `?page=-1` gets the first page, not an
 * error. That behaviour is preserved here.
 *
 * What the old parsing got wrong was the arithmetic:
 *
 *   - `parseInt('99999999999999999999')` returns 1e20, which is no longer a
 *     safe integer. Multiplying it by the limit produced a `skip` of 1e21,
 *     which is not an integer at all, and Prisma raised an error that
 *     surfaced as a 500 carrying the raw query in the message.
 *   - `parseInt('1e999')` returns 1, and `parseInt('abc')` returns NaN, which
 *     the old `|| 1` fallback quietly turned into the first page.
 *
 * Every value that leaves this module is a finite positive integer, and the
 * `skip` it produces is always a safe integer, so the database is never asked
 * for something it cannot express.
 */

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

/** The largest `skip` that is still a safe integer. */
const MAX_SAFE_SKIP = Number.MAX_SAFE_INTEGER;

/**
 * Parse a positive integer from an untrusted value.
 * @returns {number|null} the parsed value, or null when it is not a valid
 *          positive integer.
 */
export const parsePositiveInt = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;

  // Only plain decimal digits are accepted. This rejects '1e999', '0x10',
  // '1.5', ' 12 ' is tolerated by trimming, and '12abc'.
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

/**
 * Resolve the page and the limit from a query object.
 *
 * An unparseable value falls back to the default rather than raising an
 * error, which is the graceful behaviour the public API has always had.
 *
 * @param {object} query     the request query
 * @param {object} [options]
 * @param {number} [options.defaultLimit=10]
 * @param {number} [options.maxLimit=50]
 * @returns {{page: number, limit: number, skip: number}}
 */
export const resolvePagination = (query = {}, options = {}) => {
  const defaultLimit = options.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = options.maxLimit ?? MAX_LIMIT;

  // An absent, unparseable or non-positive page is the first page.
  const parsedPage = parsePositiveInt(query.page);
  const page = parsedPage ?? 1;

  // An absent, unparseable or non-positive limit is the default limit. A
  // limit above the maximum is clamped to it.
  const parsedLimit = parsePositiveInt(query.limit);
  const limit = parsedLimit === null ? defaultLimit : Math.min(parsedLimit, maxLimit);

  // The skip is clamped so it can never exceed what the database can
  // express, even if the caller asked for an absurdly large page number.
  const rawSkip = (page - 1) * limit;
  const skip = Number.isSafeInteger(rawSkip)
    ? Math.min(rawSkip, MAX_SAFE_SKIP)
    : MAX_SAFE_SKIP;

  return { page, limit, skip };
};
