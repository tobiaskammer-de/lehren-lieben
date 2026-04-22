/**
 * Prefix a relative path with the configured Astro base path.
 *
 * Astro's `import.meta.env.BASE_URL` is either "/" (no base) or "/your-base"
 * — without a trailing slash. We always normalize so callers can just write
 *
 *   <img src={asset('uploads/foo.jpg')} />
 *
 * and get the right URL in every deployment target.
 */
export function asset(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : base + '/';
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return `${normalizedBase}${normalizedPath}`;
}
