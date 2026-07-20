/** Strip HTML (and common entities) into readable plaintext for editing/preview. */
export function htmlToPlaintext(value: unknown): string {
  return String(value ?? "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li)\s*>/gi, "\n\n")
    .replace(/<\s*li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split plaintext into paragraphs (blank-line separated). */
export function plaintextParagraphs(value: unknown): string[] {
  const normalized = htmlToPlaintext(value);
  if (!normalized) return [];
  return normalized.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

/** Convert plaintext paragraphs into simple HTML for Smartlead / storage. */
export function plaintextToHtml(value: unknown): string {
  const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  // Already looks like HTML — leave alone so we don't double-wrap.
  if (/<\s*(p|br|div|html|body)\b/i.test(text)) return text;
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (!paragraphs.length) return "";
  return paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
