import { render, type ComponentChildren } from 'preact'
import { useEffect, useErrorBoundary, useRef } from 'preact/hooks'
import { LocationProvider, Route, Router, useLocation } from 'preact-iso'
import './styles/tokens.css'
import './styles/app.css'
import './audio/player.ts'
import { Dock } from './components/Dock.tsx'
import { Announcer } from './components/Reactions.tsx'
import { Empty, Toasts } from './components/ui.tsx'
import { Create } from './pages/Create.tsx'
import { Join } from './pages/Join.tsx'
import { Landing } from './pages/Landing.tsx'
import { Library } from './pages/Library.tsx'
import { RoomPage } from './pages/Room.tsx'
import { Settings } from './pages/Settings.tsx'

function NotFound() {
  return (
    <main class="page center">
      <div class="card narrow">
        <Empty icon="warn" title="This page doesn't exist."><a class="btn primary" href="/">Go home</a></Empty>
      </div>
    </main>
  )
}

/** A crash in one screen shows a friendly message, never a raw exception. Music keeps playing. */
function Safe({ children }: { children: ComponentChildren }) {
  const [error, reset] = useErrorBoundary(err => console.error('[jam] screen crashed:', err))
  if (!error) return <>{children}</>
  return (
    <main class="page center">
      <div class="card narrow">
        <Empty icon="warn" title="Something went wrong on this screen.">
          <p>Your room and music are fine.</p>
          <div class="row"><button class="btn primary" onClick={reset}>Try again</button><a class="btn" href="/">Home</a></div>
        </Empty>
      </div>
    </main>
  )
}

/** After client-side navigation, move focus to the new page's heading so screen readers follow along. */
function RouteFocus() {
  const { path } = useLocation()
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    requestAnimationFrame(() => {
      const h = document.querySelector<HTMLElement>('main h1, h1')
      if (!h) return
      h.tabIndex = -1
      h.focus({ preventScroll: true })
    })
  }, [path])
  return null
}

function App() {
  return (
    <LocationProvider>
      <a class="skip-link" href="#content" onClick={e => {
        e.preventDefault()
        const m = document.querySelector<HTMLElement>('main')
        if (m) { m.tabIndex = -1; m.focus() }
      }}>Skip to content</a>
      <Safe>
        <Router>
          <Route path="/" component={Landing} />
          <Route path="/create" component={Create} />
          <Route path="/join" component={Join} />
          <Route path="/room/:code" component={RoomPage} />
          <Route path="/library" component={Library} />
          <Route path="/settings" component={Settings} />
          <Route default component={NotFound} />
        </Router>
        <Dock />
      </Safe>
      <RouteFocus />
      <Toasts />
      <Announcer />
    </LocationProvider>
  )
}

render(<App />, document.getElementById('app')!)

// Installable app + instant start (production only; the dev server has its own reloading).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
