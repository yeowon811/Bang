import { createRoot } from 'react-dom/client';
import App from './App';
import Admin from './Admin';
import { CardConfigProvider } from './cardConfig';
import { ZoomProvider } from './zoom';
import { ZoomView } from './CardView';
import './styles.css';

const isAdmin = location.pathname.startsWith('/admin');

createRoot(document.getElementById('root')!).render(
  <CardConfigProvider>
    <ZoomProvider render={(t, mode, close) => <ZoomView target={t} mode={mode} close={close} />}>{isAdmin ? <Admin /> : <App />}</ZoomProvider>
  </CardConfigProvider>,
);
