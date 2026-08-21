import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import * as adminModule from 'firebase-admin';

if (getApps().length === 0) {
  initializeApp();
}

export const FIRESTORE_DATABASE_ID = "g-elite-g";
export const firestore = getFirestore(FIRESTORE_DATABASE_ID);
export const db = firestore;
export const storage = getStorage();

const legacyAdmin = {
  ...adminModule,
  get apps() {
    return getApps();
  },
  firestore: () => firestore,
  storage: () => storage,
  initializeApp: () => getApps()[0] || initializeApp(),
};

export default legacyAdmin;
