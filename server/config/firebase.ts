import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";

const configPath = path.join(process.cwd(), "firebase-applet-config.json");
let firebaseConfig: any = { 
  projectId: "logisticsapp-216d5", 
  firestoreDatabaseId: "ai-studio-12b741bf-685d-4d79-a3b0-c771090926cd" 
};

try {
  if (fs.existsSync(configPath)) {
    firebaseConfig = { ...firebaseConfig, ...JSON.parse(fs.readFileSync(configPath, "utf8")) };
  }
} catch (e) {
  console.warn("Could not load firebase-applet-config.json:", e);
}

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
    databaseURL: "https://logisticsapp-216d5-default-rtdb.firebaseio.com"
  };

  if (credential) {
    initOptions.credential = credential;
  }

  console.log(`Initializing Firebase Admin for project: ${firebaseConfig.projectId}, database: ${firebaseConfig.firestoreDatabaseId}`);
  admin.initializeApp(initOptions);
}

export const db = getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId);
export { admin };
