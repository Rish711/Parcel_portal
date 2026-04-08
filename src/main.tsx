import { createRoot } from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App from './App.tsx';
import './index.css';

if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    })
    .catch((error) => {
      console.warn('Failed to unregister development service worker:', error);
    });
}

createRoot(document.getElementById('root')!).render(
  <>
    <Toaster
      position="top-right"
      reverseOrder={false}
      gutter={8}
      toastOptions={{
        duration: 4000,
        style: {
          background: '#363636',
          color: '#fff',
        },
        success: {
          duration: 4000,
          style: {
            background: '#059669',
          },
        },
        error: {
          duration: 4000,
          style: {
            background: '#DC2626',
          },
        },
        loading: {
          duration: Infinity,
          style: {
            background: '#3B82F6',
          },
        },
      }}
    />
    <App />
  </>
);
