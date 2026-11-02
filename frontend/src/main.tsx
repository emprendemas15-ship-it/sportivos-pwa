import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

registerSW({
  immediate: true,
  onRegisteredSW: (_serviceWorkerUrl, registration) => {
    if (!registration) return

    const update = () => {
      void registration.update().catch((error: unknown) => {
        console.error('No se pudo comprobar si hay una actualización de Sportivos.', error)
      })
    }

    window.setInterval(update, 60_000)
    window.addEventListener('focus', update)
    window.addEventListener('online', update)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') update()
    })
    update()
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
