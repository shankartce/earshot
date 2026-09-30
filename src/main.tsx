import { render } from 'preact'
import { LocationProvider, Route, Router } from 'preact-iso'
import './styles/tokens.css'
import './styles/app.css'
import './audio/player.ts'
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

function App() {
  return (
    <LocationProvider>
      <Router>
        <Route path="/" component={Landing} />
        <Route path="/create" component={Create} />
        <Route path="/join" component={Join} />
        <Route path="/room/:code" component={RoomPage} />
        <Route path="/library" component={Library} />
        <Route path="/settings" component={Settings} />
        <Route default component={NotFound} />
      </Router>
      <Toasts />
    </LocationProvider>
  )
}

render(<App />, document.getElementById('app')!)
