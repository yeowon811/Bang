import { createRoot } from 'react-dom/client';
import App from './App';
import Admin from './Admin';
import { CardConfigProvider } from './cardConfig';
import { ZoomProvider } from './zoom';
import { ZoomView } from './CardView';
import './styles.css';

// GitHub Pages 는 경로 재작성이 안 되므로 관리자 화면은 주소 끝 #/admin 으로 구분
const isAdmin = () => location.hash.startsWith('#/admin');
window.addEventListener('hashchange', () => location.reload());

createRoot(document.getElementById('root')!).render(
  <CardConfigProvider>
    <ZoomProvider render={(t, mode, close) => <ZoomView target={t} mode={mode} close={close} />}>{isAdmin() ? <Admin /> : <App />}</ZoomProvider>
  </CardConfigProvider>,
);
