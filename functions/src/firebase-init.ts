import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as adminModule from 'firebase-admin';

if (getApps().length === 0) {
  initializeApp();
}

export const db = getFirestore("g-elite-g");

const legacyAdmin = {
  ...adminModule,
  get apps() {
    return getApps();
  },
  firestore: () => db,
  initializeApp: () => getApps()[0] || initializeApp(),
};

export default legacyAdmin;
