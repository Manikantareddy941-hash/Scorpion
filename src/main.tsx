import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './i18n';
import App from './App.tsx';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ScanProvider } from './contexts/ScanContext';
import { TerminologyProvider } from './contexts/TerminologyContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <ThemeProvider>
      <AuthProvider>
        <ScanProvider>
          <TerminologyProvider>
            <App />
          </TerminologyProvider>
        </ScanProvider>
      </AuthProvider>
    </ThemeProvider>
  </BrowserRouter>
);



