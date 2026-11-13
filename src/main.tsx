// First: moves an old sign-in over and starts watching storage writes for the account sync.
import './account/install'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './account/account.css'
import { relayPopupCallback } from './tone3000/client'
import type { BootLoader } from './account/sync'
import { bootAccount } from './account/sync'
import { startFavicon } from './favicon'
import { installPedal } from './pedal'

startFavicon()
// A foot pedal presses the screen's main or Next button (pedal.ts).
installPedal()

const join = /^\/join\/([A-Z0-9]{4})\/?$/i.exec(location.pathname)

/** A plain loader shown while songs come down from the account, before React starts. */
function domLoader(root: HTMLElement): BootLoader {
  let box: HTMLDivElement | null = null
  let text: HTMLParagraphElement | null = null
  return {
    show(t, onSkip) {
      box = document.createElement('div')
      box.className = 'boot-loader'
      box.setAttribute('role', 'status')
      text = document.createElement('p')
      text.textContent = t
      box.append(text)
      if (onSkip) {
        const skip = document.createElement('button')
        skip.className = 'btn'
        skip.textContent = 'Skip for now'
        skip.onclick = () => {
          skip.disabled = true
          onSkip()
        }
        box.append(skip)
      }
      root.replaceChildren(box)
    },
    update(t) {
      if (text) text.textContent = t
    },
    hide() {
      box?.remove()
      box = null
      text = null
    },
  }
}

async function start() {
  const root = document.getElementById('root')!
  // Bandmates joining a live jam get only the participant view: no amp, tones, settings or account.
  if (join) {
    const { ParticipantView } = await import('./session/ParticipantView')
    createRoot(root).render(
      <StrictMode>
        <ParticipantView code={join[1].toUpperCase()} />
      </StrictMode>,
    )
    return
  }
  // The account's latest data is written before the app (and anything that reads storage at load) starts.
  await bootAccount(domLoader(root))
  const { default: App } = await import('./App.tsx')
  void import('./practice/log').then((m) => m.startPracticeLog())
  root.replaceChildren()
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// The TONE3000 popup only passes its result back to the app window.
if (!relayPopupCallback()) void start()
