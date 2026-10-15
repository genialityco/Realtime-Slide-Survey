import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

const env = import.meta.env;
const useEmulators = env.VITE_USE_EMULATORS === 'true';

// The web config is public by design; access is enforced by firestore.rules.
const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY || 'demo-key',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'demo-rss',
  appId: env.VITE_FIREBASE_APP_ID,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
});

export const db = getFirestore(app);
export const auth = getAuth(app);

if (useEmulators) {
  const host = location.hostname;
  connectFirestoreEmulator(db, host, 8080);
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
}
