/**
 * Shared validation for content the administrator can create or edit.
 *
 * The rules live in one place so the blog, the vault, the categories and the
 * branching stories cannot drift apart. The slug rule is the same one the
 * story controller already used, so a slug that the story API accepts is a
 * slug the blog API accepts too.
 *
 * Every function returns `null` when the value is acceptable, and a
 * human-readable message when it is not.
 */

/** Lowercase letters, numbers and single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const LIMITS = {
  slugMax: 120,
  titleMax: 200,
  nameMax: 200,
  excerptMax: 1000,
  contentMax: 200000,
  descriptionMax: 5000,
  // The maximum length of a category name. Categories are shown in the
  // navigation and in the admin table, so they are held to the same bound as
  // an artifact name.
  categoryNameMax: 200,
};

/**
 * Validate a slug.
 *
 * A slug becomes part of a URL and, on the public pages, part of an HTML
 * attribute. Restricting it to a conservative character set means a slug
 * can never contain a quote, an angle bracket or a space, which is what
 * makes it safe to place in a URL or an attribute.
 */
export const validateSlug = (slug) => {
  if (typeof slug !== 'string' || !slug.trim()) return 'Slug is required';
  if (slug.length > LIMITS.slugMax) {
    return `Slug must be at most ${LIMITS.slugMax} characters`;
  }
  if (!SLUG_PATTERN.test(slug)) {
    return 'Slug must contain only lowercase letters, numbers and single hyphens';
  }
  return null;
};

/**
 * Validate a publication flag.
 *
 * The flag must be a real boolean. Accepting a string would make
 * `published: "false"` truthy, which would silently publish a draft.
 */
export const validatePublished = (published) => {
  if (published === undefined || published === null) return null;
  if (typeof published !== 'boolean') {
    return 'Published must be a boolean';
  }
  return null;
};

/** Validate a required string with a maximum length. */
export const validateText = (value, { field, max, required = true }) => {
  if (typeof value !== 'string' || !value.trim()) {
    return required ? `${field} is required` : null;
  }
  if (value.length > max) {
    return `${field} must be at most ${max} characters`;
  }
  return null;
};

/**
 * Validate an optional URL that will be placed in an `href` or `src`.
 *
 * Only `http:` and `https:` are accepted. A `javascript:` or `data:` URL
 * in a link is a script-execution vector, and the value is written by an
 * administrator rather than by a reader, which is not a reason to trust it.
 */
export const validateUrl = (value, { field, required = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    return required ? `${field} is required` : null;
  }
  if (typeof value !== 'string') return `${field} must be a string`;
  if (value.length > 2000) return `${field} must be at most 2000 characters`;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return `${field} must be a valid URL`;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `${field} must use http or https`;
  }
  return null;
};
