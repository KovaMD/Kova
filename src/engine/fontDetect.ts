/**
 * Canvas-based font detection. Compares measured text width against the
 * sans-serif fallback — if the font renders differently it's available.
 * Works synchronously for system fonts without any async Font Loading API.
 */
export function isFontAvailable(family: string): boolean {
  const primaryFont = family.split(',')[0].trim().replace(/['"]/g, '');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const text = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  ctx.font = `14px sans-serif`;
  const base = ctx.measureText(text).width;
  ctx.font = `14px "${primaryFont}", sans-serif`;
  return ctx.measureText(text).width !== base;
}
