import type { LatencyAdvice } from '../calibration'
import './timing.css'

/** Why the player might hear a delay, and what helps on Windows. Collapsed by default. */
export function LatencyNote({ advice }: { advice: LatencyAdvice }) {
  const { outMs, roundMs } = advice
  return (
    <details className="tm-latency">
      <summary>Why you might hear a delay</summary>
      <p>
        You hear the app about <span className="ls-num">{outMs}</span> ms after you play
        {roundMs !== null && (
          <>
            {' '}
            (Tap In measured <span className="ls-num">{roundMs}</span> ms round trip)
          </>
        )}
        . Above about 20 ms, playing starts to feel sluggish. Fretwise corrects the scoring after Tap In, but you still hear the delay.
      </p>
      <p>On Windows:</p>
      <ul>
        <li>
          Set the Scarlett Solo to 48 kHz in Windows sound settings, for playback and recording, and turn off enhancements. Fretwise runs at 48 kHz, so a 44.1 kHz
          device makes the browser convert both ways.
        </li>
        <li>Plug your headphones into the Scarlett. Bluetooth headphones add 100–300 ms.</li>
        <li>Use a cable for the guitar, not a wireless link.</li>
        <li>Close other apps that use sound, then run Tap In again.</li>
      </ul>
      <p className="ls-muted">
        Browsers on Windows can't use the Scarlett's own (ASIO) driver, so about 25–40 ms round trip is the floor even when everything is set up right.
      </p>
    </details>
  )
}
