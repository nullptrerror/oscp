// Browser-only PDF assets. Fonts ship with the app (no network access needed on exam day);
// emoji are rasterized with the system's color-emoji font because PDF text fonts cannot carry color glyphs.
import sansUrl from "dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url";
import sansBoldUrl from "dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url";
import monoUrl from "dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf?url";
import monoBoldUrl from "dejavu-fonts-ttf/ttf/DejaVuSansMono-Bold.ttf?url";

let fontsPromise = null;

export function loadPdfFonts() {
  fontsPromise ??= Promise.all([sansUrl, sansBoldUrl, monoUrl, monoBoldUrl].map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load PDF font ${url}.`);
    return new Uint8Array(await response.arrayBuffer());
  }))
    .then(([sans, sansBold, mono, monoBold]) => ({ sans, sansBold, mono, monoBold }))
    .catch((error) => {
      fontsPromise = null;
      throw error;
    });
  return fontsPromise;
}

const EMOJI_FONTS = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", "Twemoji Mozilla", "EmojiOne Color", sans-serif';
const EMOJI_PX = 96;

export async function rasterizeEmoji(emoji) {
  const canvas = document.createElement("canvas");
  canvas.width = EMOJI_PX;
  canvas.height = EMOJI_PX;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `${Math.round(EMOJI_PX * 0.8)}px ${EMOJI_FONTS}`;
  context.fillText(emoji, EMOJI_PX / 2, EMOJI_PX * 0.54);
  const pixels = context.getImageData(0, 0, EMOJI_PX, EMOJI_PX).data;
  let painted = false;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0) {
      painted = true;
      break;
    }
  }
  if (!painted) return null;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
