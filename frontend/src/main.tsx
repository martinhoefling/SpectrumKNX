import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { EmbedView } from './components/EmbedView.tsx'
import { parseViewUrl } from './utils/viewUrl.ts'

// Shared-view URLs (#150): embed mode renders only the chart area, so the
// full app (websocket table, polling, wizards) never mounts inside an iframe.
const sharedView = parseViewUrl(window.location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {sharedView?.embed ? <EmbedView view={sharedView} /> : <App />}
  </StrictMode>,
)
