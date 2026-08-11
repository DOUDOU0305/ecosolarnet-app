// Filled in once Steve creates the Firebase project (see project setup steps).
// Firebase web API keys are not secrets — access is controlled by Firestore
// security rules + auth, not by hiding this object.
export const firebaseConfig = {
  apiKey: "AIzaSyD58j0sCjiBpffryn25XzulqXaBXGAJTKE",
  authDomain: "ecosolarnet-54647.firebaseapp.com",
  projectId: "ecosolarnet-54647",
  storageBucket: "ecosolarnet-54647.firebasestorage.app",
  messagingSenderId: "938825858803",
  appId: "1:938825858803:web:edf169cf1d0d417cd70186",
};

// Everything syncs under artisans/{WORKSPACE_ID}/... in Firestore. A fixed id
// for now (Steve's own business); a natural seam for a future per-artisan id.
export const WORKSPACE_ID = "ecosolarnet";

export const FIREBASE_CONFIGURED = firebaseConfig.apiKey !== "REPLACE_ME";
