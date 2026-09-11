import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";
import firebaseConfig from '../../firebase-applet-config.json';


if (!admin.apps.length) {
  let credential: admin.credential.Credential | undefined = undefined;
  
  // Check for local Service Account Key JSON files in root
  const possibleKeyPaths = [
    path.join(process.cwd(), "serviceAccountKey.json"),
    path.join(process.cwd(), "service-account.json"),
    ...(process.env.GOOGLE_APPLICATION_CREDENTIALS ? [process.env.GOOGLE_APPLICATION_CREDENTIALS] : [])
  ];

  for (const kp of possibleKeyPaths) {
    if (fs.existsSync(kp)) {
      try {
        const serviceAccount = JSON.parse(fs.readFileSync(kp, "utf8"));
        credential = admin.credential.cert(serviceAccount);
        console.log(`🔐 Loaded Firebase Service Account credentials from: ${path.basename(kp)}`);
        break;
      } catch (err) {
        console.warn(`Failed to parse service account key at ${kp}:`, err);
      }
    }
  }

  const initOptions: admin.AppOptions = {
    projectId: firebaseConfig.projectId,
    storageBucket: firebaseConfig.storageBucket,
    databaseURL: "https://logisticsapp-216d5-default-rtdb.firebaseio.com"
  };

  if (credential) {
    initOptions.credential = credential;
  } else {
    // Cloud Run uses the service account attached to the service (ADC).
    initOptions.credential = admin.credential.applicationDefault();
  }

  console.log(`Initializing Firebase Admin for project: ${firebaseConfig.projectId}, database: ${firebaseConfig.firestoreDatabaseId}`);
  admin.initializeApp(initOptions);
}

export const isFirebaseAdminConfigured: boolean = Boolean(admin.apps.length && admin.app().options.credential);
export const firebaseProjectId: string = firebaseConfig.projectId || "logisticsapp-216d5";
export const firestoreDatabaseId: string = firebaseConfig.firestoreDatabaseId || "ai-studio-12b741bf-685d-4d79-a3b0-c771090926cd";
export const firebaseApiKey: string = firebaseConfig.apiKey || "";
export const db = getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId);
export { admin };
