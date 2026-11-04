import { useCallback, useEffect, useRef, useState } from 'react'
import { engine } from './audio/engine'
import { useEngineState } from './audio/hooks'
import type { SelectResult } from './tone3000/client'
import { handleCallback } from './tone3000/client'
import { SongMode } from './modes/SongMode'
import { JamMode } from './modes/JamMode'
import { TunerMode } from './modes/TunerMode'
import { LessonsMode } from './modes/LessonsMode'
import { AudioPanel, AudioStatus } from './components/AudioPanel'
import { AccountMenu } from './account/ui/AccountMenu'
import { ThemeToggle } from './components/ThemeToggle'

type Mode = 'song' | 'jam' | 'songs' | 'tune' | 'lessons'

export default function App() {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return (localStorage.getItem('mode') as Mode) || 'song'
    } catch {
      return 'song'
    }
  })
  const [panel, setPanel] = useState(false)
  const pick = (m: Mode) => {
    setMode(m)
    try {
      localStorage.setItem('mode', m)
    } catch {
      /* storage unavailable */
    }
  }
  // The header button already shows the active tone's name.
  const onToneLabel = useCallback(() => {}, [])
  const showSong = useCallback(() => setMode('song'), [])
  const e = useEngineState()

  // Reconnect the guitar automatically if it was connected before this page load.
  useEffect(() => {
    void engine.autoConnect()
  }, [])

  // Returning from TONE3000's tone picker: finish sign-in and hand the result to Song mode.
  const [t3kResult, setT3kResult] = useState<SelectResult | null>(null)
  const t3kHandled = useRef(false)
  const clearT3k = useCallback(() => setT3kResult(null), [])
  useEffect(() => {
    if (t3kHandled.current) return
    t3kHandled.current = true
    void handleCallback().then((r) => {
      if (!r) return
      setPanel(true)
      setT3kResult(r)
    })
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Fretwise</div>
        <nav className="tabs">
          <button className={mode === 'song' ? 'on' : ''} onClick={() => pick('song')}>
            Learn a song
          </button>
          <button className={mode === 'jam' ? 'on' : ''} onClick={() => pick('jam')}>
            Jam
          </button>
          <button className={mode === 'songs' ? 'on' : ''} onClick={() => pick('songs')}>
            Songs
          </button>
          <button className={mode === 'tune' ? 'on' : ''} onClick={() => pick('tune')}>
            Tuner
          </button>
          <button className={mode === 'lessons' ? 'on' : ''} onClick={() => pick('lessons')}>
            Lessons
          </button>
        </nav>
        <AudioStatus onOpen={() => setPanel(true)} />
        <ThemeToggle />
        <AccountMenu />
      </header>
      {e.running && e.needsResume && (
        <button className="resume-bar" onClick={() => void engine.ensureContext()}>
          🎸 Guitar reconnected. Click anywhere to turn the sound back on.
        </button>
      )}
      <main>
        {/* Song mode stays mounted so the loaded song survives switching to Jam. */}
        <div hidden={mode !== 'song'} className="mode-wrap">
          <SongMode onToneLabel={onToneLabel} onImported={showSong} onEditTone={() => setPanel(true)} />
        </div>
        {/* One jam engine (clock, band, live session) serves both the Jam and Songs tabs. */}
        <div hidden={mode !== 'jam' && mode !== 'songs'} className="mode-wrap">
          <JamMode view={mode === 'songs' ? 'songs' : 'jam'} active={mode === 'jam' || mode === 'songs'} suspend={mode === 'lessons'} />
        </div>
        {mode === 'tune' && (
          <div className="mode-wrap">
            <TunerMode onConnect={() => setPanel(true)} />
          </div>
        )}
        {mode === 'lessons' && (
          <div className="mode-wrap">
            <LessonsMode onConnect={() => setPanel(true)} />
          </div>
        )}
      </main>
      {panel && <AudioPanel onClose={() => setPanel(false)} t3kResult={t3kResult} onT3kDone={clearT3k} />}
    </div>
  )
}
