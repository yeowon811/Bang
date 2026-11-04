// Firebase 초기화. 이 값들은 웹에 공개되는 접속 정보이며, 실제 보호는 database.rules.json 이 맡는다.
import { initializeApp } from 'firebase/app';
import { browserPopupRedirectResolver, browserSessionPersistence, getAuth, initializeAuth, onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { getDatabase, ref, onValue } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyBOZQ5GhOA5W-efRia9qFlUEV2qfu3VSbc',
  authDomain: 'bang-bb040.firebaseapp.com',
  databaseURL: 'https://bang-bb040-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'bang-bb040',
  storageBucket: 'bang-bb040.firebasestorage.app',
  messagingSenderId: '1031569871558',
  appId: '1:1031569871558:web:d067e15ac027898ba57dc7',
};

/** 관리자 화면에 들어갈 수 있는 Google 계정 (database.rules.json 과 같아야 함) */
export const ADMIN_EMAILS = ['dudnjs811@gmail.com'];

export const app = initializeApp(firebaseConfig);
// 탭마다 별도 로그인 (한 브라우저에서 여러 탭으로 여러 플레이어 테스트 가능, 새로고침하면 같은 사람)
// (개발 중 코드 변경으로 모듈이 다시 실행되면 이미 초기화된 auth 를 재사용)
export const auth = (() => {
  try {
    return initializeAuth(app, { persistence: browserSessionPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  } catch {
    return getAuth(app);
  }
})();
export const db = getDatabase(app);

/** 로그인된 사용자 (없으면 익명 로그인) */
export function ensureUser(): Promise<User> {
  return new Promise((resolve, reject) => {
    const off = onAuthStateChanged(auth, (u) => {
      if (u) {
        off();
        resolve(u);
      }
    });
    if (!auth.currentUser) signInAnonymously(auth).catch((e) => {
      off();
      reject(e);
    });
  });
}

// 서버 시간 보정 (제한 시간을 모든 사람이 같은 기준으로 계산)
let serverOffset = 0;
onValue(ref(db, '.info/serverTimeOffset'), (s) => (serverOffset = Number(s.val()) || 0));
export const serverNow = () => Date.now() + serverOffset;
