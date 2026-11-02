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

    const currentEntry = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src')
    const checkPublishedVersion = async () => {
      if (!currentEntry || document.visibilityState !== 'visible') return

      const pageUrl = new URL(import.meta.env.BASE_URL, window.location.href)
      pageUrl.searchParams.set('_version_check', String(Date.now()))
      const response = await fetch(pageUrl, { cache: 'no-store' })
      if (!response.ok) throw new Error(`La verificación respondió HTTP ${response.status}.`)

      const html = new DOMParser().parseFromString(await response.text(), 'text/html')
      const latestEntry = html.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src')
      if (!latestEntry || new URL(latestEntry, response.url).href === new URL(currentEntry, document.baseURI).href) return

      await registration.unregister()
      const reloadUrl = new URL(window.location.href)
      reloadUrl.searchParams.set('_version', String(Date.now()))
      window.location.replace(reloadUrl.href)
    }

    const checkForUpdate = () => {
      void checkPublishedVersion().catch((error: unknown) => {
        console.error('No se pudo comprobar la versión publicada de Sportivos.', error)
      })
    }

    window.setInterval(update, 60_000)
    window.setInterval(checkForUpdate, 30_000)
    window.addEventListener('focus', update)
    window.addEventListener('focus', checkForUpdate)
    window.addEventListener('online', update)
    window.addEventListener('online', checkForUpdate)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        update()
        checkForUpdate()
      }
    })
    update()
    checkForUpdate()
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
