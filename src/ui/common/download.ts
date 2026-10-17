/**
 * Hands a file to the browser's downloads. Works in every browser; where the file goes is
 * the browser's choice (usually Downloads, or it asks).
 */
export function downloadText(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before the link is released.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
