import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { clock, socket } from './realtime/socket.ts'

// Phase 1 shell: proves client ↔ server ↔ clock sync. Replaced by the real app in phase 2.
function App() {
  const [status, setStatus] = useState('Connecting…')
  useEffect(() => {
    socket.on('connect', async () => {
      const est = await clock.sync()
      setStatus(est ? `Connected · offset ${est.offset.toFixed(1)}ms · rtt ${est.rtt.toFixed(1)}ms` : 'Connected')
    })
    socket.on('disconnect', () => setStatus('Reconnecting…'))
  }, [])
  return <main style="font:16px system-ui;padding:2rem;background:#140c1c;color:#f5e9f0;min-height:100vh"><h1>Free Jam</h1><p>{status}</p></main>
}

render(<App />, document.getElementById('app')!)
