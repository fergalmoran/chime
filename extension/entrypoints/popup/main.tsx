import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app.tsx';
import './style.css';

// Follow the system theme; the theme tokens switch on the `dark` class like the web app's.
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches);
applyTheme();
dark.addEventListener('change', applyTheme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
