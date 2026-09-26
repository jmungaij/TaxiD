/**
 * PostgREST filter-string hardening.
 *
 * `.or()` takes a comma-separated filter expression, so raw operator characters
 * in user input can break out of the intended clause (filter injection). Strip
 * them and escape LIKE wildcards before interpolation. Shared by every admin
 * console that offers a server-side search box.
 */
export const sanitizeOrFilterTerm = (term: string) =>
  term
    .replace(/[,()"']/g, " ")
    .replace(/[%*\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
