const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

/**
 * Automated SMS Notification trigger.
 * Triggers when a ticket status is updated in Firestore.
 */
exports.onTicketStatusUpdate = functions.region('europe-west3').firestore
    .document('tickets/{ticketId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();

        // Check if the status has changed
        if (before.status !== after.status) {
            const phone = after.passengerPhone || after.phone;
            const message = `SmartSeat Update: Your ticket #${after.id} for ${after.bus} is now ${after.status}. Safe journey!`;
            
            console.log(`[Cloud Function] Status update for ${phone}: ${message}`);
            // Integration point for SMS API (e.g., Africa's Talking, Twilio, or Yo! Payments)
        }
    });