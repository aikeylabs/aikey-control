/**
 * Copy text to clipboard with fallback for non-secure contexts (HTTP).
 * navigator.clipboard requires HTTPS or localhost; this falls back to
 * the deprecated execCommand('copy') for plain HTTP deployments.
 */
export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback: create a temporary textarea, select, and copy.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    return Promise.resolve();
  } catch {
    return Promise.reject(new Error('Copy failed'));
  } finally {
    document.body.removeChild(ta);
  }
}
