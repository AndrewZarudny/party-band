// The tab icon: the dino's head, bobbing, blinking and singing a note, so the Fretwise tab is easy to spot.
// Chrome doesn't animate GIF or SVG favicons, so the frames are swapped from here. A still head with reduced motion.
import { DINO_COLORS as C, noteGlyph, pickPath } from './lessons/dinoArt'

export interface FaviconFrame {
  dy: number // head bob, in icon pixels (up is negative)
  blink: boolean
  sing: boolean // mouth open with a note above it
}

// One loop: idle, a bob, a blink, then a sung note.
export const FRAMES: FaviconFrame[] = [
  { dy: 0, blink: false, sing: false },
  { dy: -1, blink: false, sing: false },
  { dy: 0, blink: false, sing: false },
  { dy: 0, blink: true, sing: false },
  { dy: 0, blink: false, sing: false },
  { dy: -1, blink: false, sing: true },
  { dy: -1, blink: false, sing: true },
  { dy: 0, blink: false, sing: false },
]

export const FRAME_MS = 300

/** One frame as a 32×32 SVG. */
export function faviconSvg(f: FaviconFrame): string {
  const head = `<ellipse cx="14" cy="17" rx="11.5" ry="10"/><ellipse cx="21" cy="21" rx="9.5" ry="7"/>`
  const plates = [
    [7, 9.5, 2.8],
    [13, 7, 3.4],
    [19.5, 8, 2.8],
  ]
    .map(([x, y, s]) => `<path d="${pickPath(x, y, s)}"/>`)
    .join('')
  const eye = f.blink
    ? `<path d="M14 15.5 Q17 18 20 15.5" fill="none" stroke="${C.pupil}" stroke-width="1.6" stroke-linecap="round"/>`
    : `<circle cx="17" cy="15" r="4" fill="${C.eye}" stroke="${C.outline}" stroke-width="1"/>` +
      `<circle cx="18" cy="15.6" r="2.4" fill="${C.pupil}"/><circle cx="17.2" cy="14.2" r="0.9" fill="${C.eye}"/>`
  const mouth = f.sing
    ? `<path d="M21 23 Q25.5 30.5 30 22.5 Z" fill="${C.mouth}" stroke="${C.outline}" stroke-width="1" stroke-linejoin="round"/>` +
      `<ellipse cx="25.6" cy="26" rx="2" ry="1" fill="${C.tongue}"/>`
    : `<path d="M21 23.5 Q25.5 26.5 29.5 22.5" fill="none" stroke="${C.outline}" stroke-width="1.5" stroke-linecap="round"/>`
  const note = f.sing
    ? `<g fill="${C.plate}" stroke="${C.plate}" stroke-width="1.3" stroke-linecap="round"><circle cx="26" cy="9" r="2" stroke="none"/>` +
      `<path d="${noteGlyph(26, 9)}" fill="none"/></g>`
    : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<g transform="translate(0 ${f.dy})">` +
    `<g fill="${C.plate}" stroke="${C.plateShade}" stroke-width="1.2" stroke-linejoin="round">${plates}</g>` +
    `<g fill="${C.outline}" stroke="${C.outline}" stroke-width="2.4">${head}</g>` +
    `<g fill="${C.body}">${head}</g>` +
    `<ellipse cx="9" cy="21" rx="2.6" ry="1.6" fill="${C.plate}" opacity="0.6"/>` +
    `<circle cx="27.5" cy="19" r="0.8" fill="${C.outline}"/>` +
    eye +
    mouth +
    `</g>` +
    note +
    `</svg>`
  )
}

export const faviconUrl = (f: FaviconFrame) => 'data:image/svg+xml,' + encodeURIComponent(faviconSvg(f))

/** Puts the dino in the tab and keeps it moving. Returns a stop function. */
export function startFavicon(): () => void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.append(link)
  }
  link.type = 'image/svg+xml'
  const urls = FRAMES.map(faviconUrl)
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  link.href = urls[0]
  if (still) return () => {}
  let i = 0
  // Hidden tabs get their timers slowed down by the browser, so there the dino just moves less often.
  const t = window.setInterval(() => {
    i = (i + 1) % urls.length
    link.href = urls[i]
  }, FRAME_MS)
  return () => window.clearInterval(t)
}
