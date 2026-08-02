import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './context/AuthContext'
import { DialogProvider } from './context/DialogContext'
import App from './App'
import './index.css'
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals'

const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
const DEFAULT_API_BASE = isLocalHost ? 'http://localhost:3001' : 'https://flows-api.onionws.com'
const API_BASE = import.meta.env.VITE_API_URL || DEFAULT_API_BASE

const reportWebVital = (metric) => {
  try {
    if (Math.random() > 0.1) return
    const token = localStorage.getItem('token')
    const payload = {
      ...metric,
      page: window.location.pathname
    }

    fetch(`${API_BASE}/api/metrics/web-vitals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload)
    }).catch(() => {})
  } catch (e) {
    // ignore
  }
}

onCLS(reportWebVital)
onFCP(reportWebVital)
onINP(reportWebVital)
onLCP(reportWebVital)
onTTFB(reportWebVital)

const root = ReactDOM.createRoot(document.getElementById('root'))
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <DialogProvider>
          <Toaster
            position="top-center"
            gutter={6}
            containerStyle={{ top: 10 }}
            toastOptions={{
              duration: 3000,
              style: {
                maxWidth: '320px',
                padding: '7px 10px',
                borderRadius: '10px',
                fontSize: '12px',
                lineHeight: '16px',
              },
              iconTheme: {
                primary: '#2563eb',
                secondary: '#ffffff',
              },
            }}
          />
          <App />
        </DialogProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
