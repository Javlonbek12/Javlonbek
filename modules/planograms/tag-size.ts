// A price tag's font: long tags ("28 000 1mg") get a smaller font so they fit the pack width,
// never below 6 px. The same rule for the picture, the PPTX and the editor.
export function tagFontSize(text: string, width: number, base: number) {
  return Math.min(base, Math.max(6, Math.floor((width - 4) / (text.length * 0.62))));
}
