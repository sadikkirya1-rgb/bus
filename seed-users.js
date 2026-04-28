var admin = require("firebase-admin");

// Load service account from a local JSON file. 
// Ensure this file is added to your .gitignore so it is never committed.
var serviceAccount = require("./service-account.json");

/**
 * This script seeds your Firebase project with sample users and assigns roles using Custom Claims.
 * To run this:
 * 1. Ensure dependencies are installed: npm install firebase-admin
 * 2. Run: node seed-users.js
 */

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function setupUser(email, password, role) {
  try {
    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
      console.log(`User ${email} already exists. Updating claims...`);
    } catch (e) {
      user = await admin.auth().createUser({ email, password });
      console.log(`Created new user: ${email}`);
    }

    await admin.auth().setCustomUserClaims(user.uid, { role });
    console.log(`Assigned role '${role}' to ${email}`);

    // Create Firestore profile so script.js can read the role
    await admin.firestore().collection('users').doc(user.uid).set({
      name: email.split('@')[0].toUpperCase(),
      email: email,
      role: role,
      id: user.uid,
      timestamp: new Date().toISOString()
    });
    console.log(`Firestore profile created for ${email}`);
  } catch (error) {
    console.error(`Failed to setup user ${email}:`, error.message);
  }
}

setupUser('admin@bus.ug', '123456', 'admin');
setupUser('user@bus.ug', '123456', 'user');
setupUser('bus@bus.ug', '123456', 'bus');