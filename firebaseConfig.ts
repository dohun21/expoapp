// firebaseConfig.ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyB8gD1YvI9u57s54avScaw6oOSC_C08N6I",
  authDomain: "studyfit-51f79.firebaseapp.com",
  projectId: "studyfit-51f79",
  storageBucket: "studyfit-51f79.firebasestorage.app",
  messagingSenderId: "490364371212",
  appId: "1:490364371212:web:66c3b260abca3d2679c929",
  measurementId: "G-CBZRPHX06F"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };

