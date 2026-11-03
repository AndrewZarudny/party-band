// Identifies this host page, so only one window controls a live session (kept across reloads).
// Phones open the app over plain http on the Wi-Fi, where crypto.randomUUID doesn't exist, so
// this uses getRandomValues (available everywhere) and must never throw: it loads on every page.
function randomId() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const HOST_ID = (() => {
  try {
    const id = sessionStorage.getItem('host-id') ?? randomId()
    sessionStorage.setItem('host-id', id)
    return id
  } catch {
    return randomId()
  }
})()
