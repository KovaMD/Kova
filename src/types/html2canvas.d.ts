declare module 'html2canvas' {
  interface Html2CanvasOptions {
    backgroundColor?: string | null;
    /** Deliberately not enabled by callers in this codebase — the SVG
     *  foreignObject + Image + canvas.drawImage technique it opts into is the
     *  exact WebKit-incompatible path html2canvas exists to avoid (see
     *  mathToDataUrl in exportPptx.ts). */
    foreignObjectRendering?: boolean;
    scale?: number;
    logging?: boolean;
  }
  export default function html2canvas(
    element: HTMLElement,
    options?: Html2CanvasOptions,
  ): Promise<HTMLCanvasElement>;
}
