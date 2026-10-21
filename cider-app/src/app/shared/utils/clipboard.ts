/**
 * Copies text to the clipboard. The clipboard API only exists on HTTPS (or
 * localhost); on a local network address the old way (selection + copy
 * command) is used.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall back to the copy command
    }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let done = false;
  try {
    // deprecated but still the only way without a secure context
    done = document.execCommand('copy');
  } finally {
    area.remove();
  }
  return done;
}
