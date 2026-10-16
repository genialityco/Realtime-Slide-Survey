import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const env = import.meta.env;
const useEmulators = env.VITE_USE_EMULATORS === 'true';

// The web config is public by design.
const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY || 'demo-key',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'demo-rss',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: env.VITE_FIREBASE_APP_ID,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
});

export const db = getFirestore(app);
export const auth = getAuth(app);
/** Firebase Storage for slide images; null locally (uploads are then embedded in the slide). */
export const storage = !useEmulators && env.VITE_FIREBASE_STORAGE_BUCKET ? getStorage(app) : null;

if (useEmulators) {
  const host = location.hostname;
  connectFirestoreEmulator(db, host, Number(env.VITE_FIRESTORE_EMULATOR_PORT) || 8080);
  connectAuthEmulator(auth, `http://${host}:${env.VITE_AUTH_EMULATOR_PORT || 9099}`, { disableWarnings: true });
}
