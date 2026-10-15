// Creates the local admin account in the emulators: admin@example.com / admin123
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

const EMAIL = 'admin@example.com';
const PASSWORD = 'admin123';

initializeApp({ projectId: 'demo-rss' });
const auth = getAuth();
const user = await auth.getUserByEmail(EMAIL).catch(() => auth.createUser({ email: EMAIL, password: PASSWORD }));
await getFirestore().doc('simposio_leucemias_2026/admins').set({ uids: [user.uid] });
console.log(`Admin local listo: ${EMAIL} / ${PASSWORD}`);
