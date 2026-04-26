import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx'

if (typeof window !== 'undefined') {
    const appendCrashLog = (payload: Record<string, unknown>) => {
        try {
            const existingRaw = window.localStorage.getItem('SVI_CRASH_LOG')
            const existing = existingRaw ? (JSON.parse(existingRaw) as unknown[]) : []
            const next = [...existing, payload].slice(-20)
            window.localStorage.setItem('SVI_CRASH_LOG', JSON.stringify(next))
        } catch {
            // swallow
        }
    }

    window.addEventListener('error', (event) => {
        appendCrashLog({
            ts: Date.now(),
            kind: 'window.error',
            message: event.message,
            filename: event.filename,
            line: event.lineno,
            column: event.colno,
            stack: event.error instanceof Error ? event.error.stack ?? null : null,
        })
    })

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason
        appendCrashLog({
            ts: Date.now(),
            kind: 'window.unhandledrejection',
            message: reason instanceof Error ? reason.message : String(reason),
            stack: reason instanceof Error ? reason.stack ?? null : null,
        })
    })
}

createRoot(document.getElementById('root')!).render(
    <AppErrorBoundary>
        <App />
    </AppErrorBoundary>
)
