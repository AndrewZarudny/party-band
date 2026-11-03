import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { relayPopupCallback } from './tone3000/client'
import { ParticipantView } from './session/ParticipantView'

const join = /^\/join\/([A-Z0-9]{4})\/?$/i.exec(location.pathname)

// The TONE3000 popup only passes its result back to the app window.
if (!relayPopupCallback())
  createRoot(document.getElementById('root')!).render(
    // Bandmates joining a live jam get only the participant view: no amp, tones or settings.
    <StrictMode>{join ? <ParticipantView code={join[1].toUpperCase()} /> : <App />}</StrictMode>,
  )
