// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyCn0Ixqy8VMzzGmlo9i_z91jpHGKtHSNiE",
  authDomain: "ugbus-518c8.firebaseapp.com",
  projectId: "ugbus-518c8",
  storageBucket: "ugbus-518c8.firebasestorage.app",
  messagingSenderId: "1095576782736",
  appId: "1:1095576782736:web:10296a39d485b1afe01515",
  measurementId: "G-DNG142TNRW"
};

// Initialize Firebase (Compat mode for global script usage)
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// Enable session persistence so different tabs can maintain different roles/logins
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);

const db = firebase.firestore();
const analytics = firebase.analytics();

// Global State
let currentUser = null;
let role = null;
let selectedSeat = null;
let selectedBus = null; // This will still hold bus details like name and price
let selectedPayment = null;

let tickets = [];
let buses = [];
let trips = [];
let users = [];
let notifications = [];
let broadcasts = [];
let refunds = [];
let terminals = [];
let maintenanceMode = false;

let terminalSearchQuery = "";
let html5QrCode = null;
let adminRefreshInterval = null;
let activeSearchSchedules = null; // Tracks current search results for real-time updates

// Development constants
const TEST_USER_EMAIL = "user@bus.ug";
const TEST_USER_NAME = "John Doe";

// --- FIREBASE AUTH LISTENER ---
auth.onAuthStateChanged(async (user) => {
    if (user) {
        // Fetch detailed user profile from Firestore
        const userDoc = await db.collection('users').doc(user.uid).get();
        if (userDoc.exists) {
            currentUser = { ...userDoc.data(), uid: user.uid };
            role = currentUser.role;
            console.log("onAuthStateChanged: User logged in, role is", role);
            
            // Start Real-time Listeners for Production Data
            setupRealtimeData();
            init();
        } else {
            console.warn("User authenticated but no profile found in Firestore.");
            logout();
        }
    } else {
        currentUser = null;
        role = null;
        console.log("onAuthStateChanged: User logged out, role is", role);
        init();
    }
});

// Helper to format time strings (HH:MM or HH:MM AM/PM) into standard AM/PM format
function formatTimeAMPM(timeStr) {
    if (!timeStr) return "08:00 AM";
    const cleanTime = timeStr.trim().toUpperCase();
    if (cleanTime.includes("AM") || cleanTime.includes("PM")) return cleanTime;
    
    let [hours, minutes] = timeStr.split(':');
    hours = parseInt(hours);
    if (isNaN(hours)) return timeStr;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; 
    return `${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
}

function setupRealtimeData() {
    // Sync Firestore collections to local arrays in real-time
    db.collection('tickets').onSnapshot(snap => {
        tickets = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        if (role === 'user') renderUpcomingJourneys();
    });
    db.collection('trips').onSnapshot(snap => {
        trips = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        
        // Auto-refresh search results if user is currently looking at the trips screen
        const tripsPanel = document.getElementById('trips');
        const userHome = document.getElementById('userHome'); // Check if userHome is active
        
        if (role === 'user' && userHome && !userHome.classList.contains('hidden') && tripsPanel && !tripsPanel.classList.contains('hidden') && document.getElementById('from') && document.getElementById('to')) { // Added checks for 'from' and 'to' elements
            console.log("trips onSnapshot: User UI is active, potentially calling loadTrips().");
            if (activeSearchSchedules) {
                const from = document.getElementById('from').value;
                const to = document.getElementById('to').value;
                const date = document.getElementById('date').value;
                const updated = trips.filter(t => t.busName === activeSearchSchedules.name && t.from === from && t.to === to && t.date === date);
                renderOperatorSchedules(activeSearchSchedules.name, updated);
            } else {
                loadTrips();
            }
        }
        if (role === 'admin' || role === 'bus') renderSchedules();
    });
    db.collection('buses').onSnapshot(snap => {
        buses = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        if (role === 'admin' || role === 'bus') { loadBusSelect(); renderFleet(); }
    });
    db.collection('users').onSnapshot(snap => {
        users = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    });
    db.collection('notifications').onSnapshot(snap => {
        notifications = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        updateNotificationBadge();
    });
    db.collection('broadcasts').orderBy('timestamp', 'desc').onSnapshot(snap => {
        broadcasts = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        if (role === 'admin' && !document.getElementById('adminNotifications').classList.contains('hidden')) renderBroadcastHistory();
    });
    db.collection('terminals').onSnapshot(snap => {
        terminals = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        populateCityLists();
        if (role === 'admin') loadTerminals();
    });
    db.collection('settings').doc('config').onSnapshot(doc => {
        if (doc.exists) {
            maintenanceMode = doc.data().maintenanceMode || false;
            const toggle = document.getElementById('maintenanceToggle');
            if (toggle) toggle.checked = maintenanceMode;

            const banner = document.getElementById('maintenanceBanner');
            if (banner) {
                if (maintenanceMode) banner.classList.remove('hidden');
                else banner.classList.add('hidden');
            }
        }
    });
}

// Helper function to get the current date in Kampala timezone (YYYY-MM-DD)
function getKampalaDateISO(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Kampala',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

// Helper to compare "HH:MM AM/PM" strings chronologically
function getMinutesFromMidnight(timeStr) {
    if (!timeStr) return 0;
    const timeStrClean = timeStr.replace(/\s+/g, '');
    const [hPart, mFull] = timeStrClean.split(':');
    if (!mFull || mFull.length < 3) return 0;
    const mPart = mFull.slice(0, -2);
    const ampm = mFull.slice(-2).toUpperCase();
    let hrs = parseInt(hPart);
    if (ampm === 'PM' && hrs < 12) hrs += 12;
    if (ampm === 'AM' && hrs === 12) hrs = 0;
    return hrs * 60 + parseInt(mPart);
}

// Robust helper to get the current "Wall Clock" time in Kampala as a comparable timestamp
function getKampalaWallClockTime() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Kampala',
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: false
    });
    const p = formatter.formatToParts(now).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
}

// Helper function to get the current Date object in Kampala timezone
function getKampalaDateObject(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Kampala',
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: false // Use 24-hour format for easier parsing
    });
    const parts = formatter.formatToParts(date);
    const year = parseInt(parts.find(p => p.type === 'year').value);
    const month = parseInt(parts.find(p => p.type === 'month').value) - 1; // Month is 0-indexed
    const day = parseInt(parts.find(p => p.type === 'day').value);
    const hour = parseInt(parts.find(p => p.type === 'hour').value);
    const minute = parseInt(parts.find(p => p.type === 'minute').value);
    const second = parseInt(parts.find(p => p.type === 'second').value);

    return new Date(year, month, day, hour, minute, second);
}

// --- SMS GATEWAY INTEGRATION (MOCK) ---
/**
 * In a production environment, this would call a service like Africa's Talking or Twilio.
 * For Uganda, local gateways like Yo! Payments or Infobip are common.
 */
async function sendSMS(phoneNumber, message) {
  console.log(`[SMS GATEWAY] Sending to ${phoneNumber}: ${message}`);
  
  // Simulate API call
  return new Promise((resolve) => {
    setTimeout(() => {
      showNotification(`SMS Sent to ${phoneNumber}`, "info");
      addActivityLog(`SMS sent to ${phoneNumber}: ${message.substring(0, 20)}...`);
      resolve({ success: true });
    }, 800);
  });
}

/**
 * Universal notification dispatcher for SMS, WhatsApp, and Email.
 */
async function dispatchMultiChannel(contact, message, channels = ['sms', 'whatsapp', 'email']) {
    console.log(`[DISPATCH] Target: ${contact}`);
    if (channels.includes('sms')) await sendSMS(contact, message);
    
    if (channels.includes('whatsapp')) {
        console.log(`[WHATSAPP] Sending to ${contact}: ${message}`);
        addActivityLog(`WhatsApp sent to ${contact}`);
    }
    
    if (channels.includes('email')) {
        console.log(`[EMAIL] Sending to ${contact}: ${message}`);
    }
}

/**
 * Log a manual call made by the Admin to a customer.
 */
function logAdminCall(passengerName, phone, notes) {
    const logMsg = `ADMIN CALL: Reached ${passengerName} (${phone}). Note: ${notes}`;
    addActivityLog(logMsg);
    showNotification("Call logged for " + passengerName, "info");
}

/**
 * Validates a Ugandan phone number (starts with 07... or +2567...)
 */
function validateUgandaPhone(phone) {
    const cleanPhone = phone.replace(/[\s\-()]/g, '');
    const regex = /^(\+256|0)7[0-9]{8}$/;
    return regex.test(cleanPhone);
}

function formatTicketSMS(t) {
  return `UGBUS TICKETS TICKET #${t.id}\n` +
         `Bus: ${t.bus}\n` +
         `Route: ${t.from} to ${t.to}\n` +
         `Date: ${t.date} @ ${t.time || '08:00'}\n` +
         `Seat: ${t.seat}. Safe journey!`;
}

let ugandaCitiesList = ["Kampala", "Jinja", "Entebbe", "Mbarara", "Gulu", "Lira", "Mbale", "Masaka", "Fort Portal", "Arua", "Soroti", "Kabale", "Hoima", "Tororo"];
let notificationTimeouts = {};

/* DYNAMIC INFO TICKER */
let currentInfoIndex = 0;
const infoItems = [
  { type: 'PROMOTION', title: 'Weekend Special', detail: 'Get 20% cashback on all trips to Jinja this weekend!', icon: 'fa-gift', color: '#FCD116' },
  { type: 'ANNOUNCEMENT', title: 'New Route Added', detail: 'We now operate daily direct buses from Kampala to Lira.', icon: 'fa-bullhorn', color: '#ff6b6b' },
  { type: 'TRENDING ROUTE', title: 'Kampala → Mbarara', detail: 'Travel in luxury for only UGX 25,000.', icon: 'fa-route', color: '#48bb78' },
  { type: 'SPONSORED', title: 'MTN MoMo Pay', detail: 'Pay for your bus ticket using MoMo and win instant prizes!', icon: 'fa-ad', color: '#63b3ed' },
  { type: 'DAILY DEAL', title: 'Kampala → Gulu', detail: 'Limited seats available at UGX 30,000 today!', icon: 'fa-bolt', color: '#f6ad55' }
];

function rotateInfoTicker() {
  const content = document.getElementById('tickerContent');
  if (!content) return;

  // Fade out
  content.style.opacity = '0';
  
  setTimeout(() => {
    const item = infoItems[currentInfoIndex];
    content.innerHTML = `
      <div style="color: ${item.color}; font-weight: bold; font-size: 0.7rem; letter-spacing: 1px; margin-bottom: 5px;">
        <i class="fas ${item.icon}"></i> ${item.type}
      </div>
      <h4 style="margin: 0 0 5px 0; color: #fff; font-size: 1.1rem;">${item.title}</h4>
      <p style="margin: 0; font-size: 0.9rem; color: rgba(255,255,255,0.8);">${item.detail}</p>
    `;
    // Fade in
    content.style.opacity = '1';
    currentInfoIndex = (currentInfoIndex + 1) % infoItems.length;
  }, 500);
}

function startInfoTicker() {
  if (window.tickerInterval) return;
  rotateInfoTicker();
  window.tickerInterval = setInterval(rotateInfoTicker, 6000);
}

/* ONBOARDING & SPLASH */
function checkFirstVisit() {
  const welcomeEl = document.getElementById('splashWelcome');
  const splashScreen = document.getElementById('splashScreen');
  const onboardingModal = document.getElementById('onboardingModal');

  if (currentUser && welcomeEl) {
    welcomeEl.innerText = `Welcome back, ${currentUser.name.split(' ')[0]}!`;
    welcomeEl.classList.add('fade-in');
  }

  setTimeout(() => {
    splashScreen?.style && (splashScreen.style.opacity = '0');
    setTimeout(() => splashScreen?.classList?.add('hidden'), 500);
    if (!localStorage.getItem("onboarded") && onboardingModal) {
      onboardingModal.classList.remove('hidden');
    }
  }, 2000);
}

function hideSplashScreen() {
  const splash = document.getElementById('splashScreen');
  if (splash && !splash.classList.contains('hidden')) {
    splash.style.opacity = '0';
    setTimeout(() => splash.classList.add('hidden'), 500);
  }
}

function nextOnboarding(step) {
  document.getElementById('onboardingStep1').classList.add('hidden');
  document.getElementById('onboardingStep2').classList.add('hidden');
  document.getElementById('onboardingStep3').classList.add('hidden');
  document.getElementById(`onboardingStep${step}`).classList.remove('hidden');
}

function closeOnboarding() {
  localStorage.setItem("onboarded", "true");
  document.getElementById('onboardingModal').classList.add('hidden');
}

function saveRecentSearch(from, to) {
  let searches = JSON.parse(localStorage.getItem("recentSearches") || "[]");
  // Remove duplicate if it exists
  searches = searches.filter(s => !(s.from === from && s.to === to));
  // Add to front
  searches.unshift({ from, to });
  // Keep last 3
  localStorage.setItem("recentSearches", JSON.stringify(searches.slice(0, 3)));
  renderRecentSearches();
}

function renderRecentSearches() {
  const searches = JSON.parse(localStorage.getItem("recentSearches") || "[]");
  const container = document.getElementById('recentSearchChips');
  
  if (!container) return;

  if (searches.length === 0 || !searches[0]) {
    container.classList.add('hidden');
    return;
  }
  
  container.classList.remove('hidden');
  const s = searches[0];
  container.innerHTML = `
    <div class="search-chip" onclick="reRunSearch('${s.from}', '${s.to}')">
      <i class="fas fa-history"></i> ${s.from} → ${s.to}
    </div>
  `;
}

function reRunSearch(from, to) {
  document.getElementById('from').value = from;
  document.getElementById('to').value = to;
  filterToCities();
  loadTrips();
}

function updateNotificationBadge() {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  const count = notifications.filter(n => !n.read).length;
  if (count > 0) {
    badge.innerText = count > 99 ? '99+' : count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function toggleNotificationDropdown(event) {
  event.stopPropagation();
  const dropdown = document.getElementById('notifDropdown');
  const isOpening = !dropdown.classList.contains('active');

  if (isOpening) {
    renderNotificationDropdown();
    markNotificationsRead();
  }
  dropdown.classList.toggle('active');
}

function renderNotificationDropdown() {
  const content = document.getElementById('notifDropdownContent');
  if (!content) return;

  const latest = [...notifications].sort((a, b) => b.id - a.id).slice(0, 3);

  if (latest.length === 0) {
    content.innerHTML = '<div class="notif-item">No notifications</div>';
    return;
  }

  content.innerHTML = latest.map(n => `
    <div class="notif-item">
      <strong>${n.title}</strong>
      <p>${n.message.substring(0, 40)}${n.message.length > 40 ? '...' : ''}</p>
      <small>${new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
    </div>
  `).join('') + '<div class="notif-view-all" onclick="userTab(\'support\')">View All</div>';
}

function markNotificationsRead() {
  notifications.forEach(n => n.read = true);
  localStorage.setItem('notifications', JSON.stringify(notifications));
  updateNotificationBadge();
}

function renderUpcomingJourneys() {
  const container = document.getElementById('upcomingJourneyList');
  if (!container || !currentUser) return;

  // Filter tickets for current user and future/current status
  const userTickets = tickets.filter(t => 
    (t.uid === currentUser.uid || 
     t.email?.toLowerCase() === currentUser.email?.toLowerCase() || 
     (t.passenger?.toLowerCase() === currentUser.name?.toLowerCase())) && 
    ["PENDING", "PAID", "ACTIVE", "VERIFIED", "BOARDED"].includes(t.status)
  ).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 3);

  if (userTickets.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding: 20px; background: rgba(255,255,255,0.05); border-radius: 12px; border: 1px dashed rgba(255,255,255,0.2);">
        <p style="color:rgba(255,255,255,0.8); font-size:0.9rem; margin-bottom: 10px;">You haven't booked any journeys yet.</p>
        <button class="view-ticket-btn" style="margin: 0 auto; display: block;" onclick="document.getElementById('from').focus()">
          <i class="fas fa-search"></i> Find and Book a Bus
        </button>
      </div>`;
    return;
  }

  const todayISO = getKampalaDateISO();
  const kampalaNow = new Date();
  const todayLabelStr = new Intl.DateTimeFormat('en-GB', { 
      timeZone: 'Africa/Kampala', day: '2-digit', month: 'short', year: 'numeric' 
  }).format(kampalaNow);

  container.innerHTML = userTickets.map((t, index) => {

    const standardTimes = ["08:00 AM", "11:00 AM", "02:00 PM", "06:00 PM"];
    
    const tripData = trips.find(trip => trip.busName === t.bus);
    const amenities = tripData ? tripData.amenities : [];

    // Get daily scheduled trips for this specific route (Daily Terminal View)
    const terminalTrips = trips.filter(tr => tr.from === t.from && tr.to === t.to && tr.date === 'DAILY')
                               .sort((a,b) => getMinutesFromMidnight(a.time) - getMinutesFromMidnight(b.time));

    const terminalData = terminals.find(term => term.city === t.from);
    const terminalName = terminalData ? terminalData.name : `Unassigned (${t.from})`;
    const nowWall = getKampalaWallClockTime();
    const fillWindowMs = 12 * 60 * 60 * 1000; // Fill progress across the upcoming 12-hour window
    let focusFound = false;
    let activeSectionHtml = "";

    const timesRowHtml = terminalTrips.map((tr) => {
        const mins = getMinutesFromMidnight(tr.time || "08:00 AM");
        const hrs = Math.floor(mins / 60);
        const mPart = mins % 60;
        const [y, m_val, d] = (tr.date === 'DAILY' ? todayISO : tr.date).split('-').map(Number);
        
        const departureWall = Date.UTC(y, m_val - 1, d, hrs, mPart, 0);
        const diff = departureWall - nowWall; // Difference in milliseconds

        const manualFinished = tr.manualFinished || false;
        const manualLive = tr.manualLive || false;
        const finished = diff <= -15 * 60 * 1000 || manualFinished;
        const isLive = (diff <= 0 && diff > -15 * 60 * 1000) || manualLive;
        const isUrgent = diff > 0 && diff < 5 * 60 * 1000;
        const isBoarding = diff > 0 && diff < 30 * 60 * 1000;
        const isUserSlot = t.date === todayISO && tr.time === t.time && tr.busName === t.bus;

        let isActive = false;
        if (!finished && !focusFound) {
            isActive = true;
            focusFound = true; // Mark that we found the first active slot

            let statusText = "";
            let barWidth = "0%";
            let barColor = "var(--primary-color)";

            if (isLive) {
                statusText = `<span class="status-live" style="font-size: 0.85rem;"><span class="live-dot"></span> LIVE</span>`;
                barWidth = "100%"; // Live means it's already past departure
                barColor = "var(--uganda-red)";
            } else if (isUrgent) {
                statusText = `<span class="status-urgent" style="font-size: 0.85rem;"><i class="fas fa-exclamation-triangle"></i> URGENT</span>`;
                const totalSec = Math.floor(diff / 1000);
                const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
                const ss = String(totalSec % 60).padStart(2, '0');
                statusText += ` <small>${mm}m ${ss}s</small>`;
                barWidth = Math.max(0, Math.min(100, (30 * 60 * 1000 - diff) / (30 * 60 * 1000) * 100)) + "%"; // Progress within 30 min window
                barColor = "var(--uganda-red)";
            } else if (isBoarding) {
                statusText = `<span class="status-boarding" style="font-size: 0.85rem;"><i class="fas fa-door-open"></i> BOARDING</span>`;
                barWidth = Math.max(0, Math.min(100, (30 * 60 * 1000 - diff) / (30 * 60 * 1000) * 100)) + "%"; // Progress within 30 min window
                barColor = "var(--uganda-yellow)";
            } else {
                const totalSec = Math.floor(diff / 1000);
                const hh = String(Math.floor((totalSec / 3600) % 24)).padStart(2, '0');
                const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
                const ss = String(totalSec % 60).padStart(2, '0');
                statusText = `<span style="color: white; font-weight: 700;">${hh}h ${mm}m ${ss}s</span> <small style="opacity:0.7;">left</small>`;
                if (diff <= fillWindowMs) {
                    barWidth = Math.max(0, Math.min(100, ((fillWindowMs - diff) / fillWindowMs) * 100)) + "%";
                } else {
                    barWidth = "0%";
                }
                barColor = "var(--primary-color)"; // Default color
            }

            let btnText = "Book Today";
            const btnOnClick = `event.stopPropagation(); showTerminalBuses('${t.from}', '${t.to}', '${t.date}')`;
            let delayHtml = tr.delayReason ? `<div style="font-size: 0.65rem; color: var(--uganda-yellow); margin-top: 4px;"><i class="fas fa-info-circle"></i> Delay: ${tr.delayReason}</div>` : '';

            const timePulseClass = (isUrgent || isLive) ? "pulse-live" : "";

            activeSectionHtml = `
              <div style="margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.4); border-radius: 8px; border: 1px solid rgba(0,0,0,0.3); border-left: 3px solid ${isBoarding ? 'var(--primary-color)' : (isActive ? 'var(--uganda-yellow)' : 'transparent')};">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="font-size: 0.6rem; color: var(--uganda-yellow); font-weight: bold; text-transform: uppercase;">Next Departure:</span>
                    <span class="${timePulseClass}" style="font-size: 0.8rem; color: var(--uganda-yellow); font-weight: 800;">${tr.time}</span>
                  </div>
                  <div style="font-size: 0.75rem; font-variant-numeric: tabular-nums;">${statusText}</div>
                </div>
                <div class="progress-container" style="height: 4px; margin: 6px 0;">
                  <div class="progress-bar" style="width: ${barWidth}; background: ${barColor};"></div>
                </div>
                ${delayHtml}
              </div>
            `;
        }

        let chipColor = 'white';
        let chipWeight = '400';
        let decor = 'none';

        if (finished) {
            chipColor = 'var(--uganda-red)';
            decor = 'line-through';
        } else if (isActive || isLive || isBoarding || isUrgent) {
            chipColor = 'var(--uganda-yellow)';
            chipWeight = '800';
        }

        return `<span style="color: ${chipColor}; text-decoration: ${decor}; font-weight: ${chipWeight}; font-size: 0.8rem; white-space: nowrap; flex-shrink: 0;">${tr.time}${isUserSlot ? ' <i class="fas fa-ticket-alt" style="font-size: 0.6rem;"></i>' : ''}</span>`;
    }).join(' <span style="opacity: 0.1;">|</span> ');

    return `
      <div class="upcoming-card" onclick="showTerminalBuses('${t.from}', '${t.to}', '${t.date}')">
        <div class="up-num"></div>
        <div class="up-center">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div class="up-terminal">${terminalName}</div>
            <div style="font-weight: 800; color: var(--uganda-yellow); font-size: 0.85rem;">${t.from} → ${t.to}</div>
          </div>
          
          <div style="margin-top: 10px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px; flex-wrap: wrap;">
              <span style="font-size: 0.6rem; color: white; opacity: 1; font-weight: 600;">${todayLabelStr}</span>
              <span style="font-size: 0.6rem; text-transform: uppercase; color: var(--uganda-yellow); font-weight: bold; opacity: 0.8;">Terminal Slots</span>
              <div style="margin-left: auto; display: flex; gap: 6px; align-items: center;">
                <button class="view-ticket-btn" style="margin: 0; font-size: 0.55rem; padding: 2px 8px; background: var(--uganda-yellow); color: black; font-weight: bold; box-shadow: 0 0 10px rgba(252, 209, 22, 0.5);" onclick="event.stopPropagation(); showTerminalBuses('${t.from}', '${t.to}', '${t.date}')">BOOK NOW</button>
                <button class="quick-btn" style="background:#4299e1; width:20px; height:20px; font-size: 0.6rem;" onclick="event.stopPropagation(); shareETA(${t.id})" title="Share ETA"><i class="fas fa-share-nodes"></i></button>
              </div>
            </div>
            <div style="display: flex; flex-wrap: nowrap; gap: 4px; align-items: center; background: rgba(0,0,0,0.4); padding: 8px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.3); overflow-x: auto; width: 100%;">
              ${timesRowHtml}
            </div> 
            ${activeSectionHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Helper to quickly set search for tomorrow's date
 */
window.rebookTomorrow = function(from, to) {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowStr = getKampalaDateISO(tomorrow);
    
    document.getElementById('from').value = from;
    document.getElementById('to').value = to;
    document.getElementById('date').value = tomorrowStr;
    
    const btns = document.querySelectorAll('.date-btn');
    btns.forEach(b => b.classList.remove('active'));
    document.getElementById('btnOthers').classList.add('active');
    document.getElementById('btnOthers').innerText = tomorrowStr;
    document.getElementById('date').classList.remove('hidden');
    loadTrips();
};

/**
 * Populate search fields and initiate a search for a specific slot time.
 */
window.initiateRebook = function(from, to, time) {
    document.getElementById('from').value = from;
    document.getElementById('to').value = to;
    
    setSearchDate('today');
    userTab('home');
    loadTrips();
    
    showNotification(`Rebooking initiated for ${from} to ${to}.`, "info");
};

function shareETA(id) {
  const t = tickets.find(ticket => ticket.id == id);
  if (!t) return;
  const shareText = `I'm on the ${t.bus} bus from ${t.from} to ${t.to}. Follow my journey! Ticket #${t.id}`;
  if (navigator.share) {
    navigator.share({ title: 'My Journey ETA', text: shareText, url: window.location.href });
  } else {
    navigator.clipboard.writeText(shareText);
    showNotification("ETA details copied to clipboard!", "success");
  }
}

function showUserScreen(screenId) {
  const screens = ['search-section', 'upcomingJourneys', 'trips', 'busDetailsBox', 'seatBox', 'pointsBox', 'passengerBox', 'bookingConfirm'];
  screens.forEach(s => {
    const el = document.getElementById(s); // seatBox will now always be hidden or removed
    if (el) el.classList.add('hidden');
  });
  
  const active = document.getElementById(screenId);
  if (active) active.classList.remove('hidden');
  window.scrollTo(0,0);
}

function showTerminalBuses(from, to, date) {
  // Fill the search fields to simulate a real search
  document.getElementById('from').value = from;
  document.getElementById('to').value = to;
  document.getElementById('date').value = date;
  
  // Set the "Others" button text if necessary
  const othersBtn = document.getElementById('btnOthers');
  if (othersBtn) othersBtn.innerText = date;
  
  // Highlight the correct search parameters and trigger loadTrips
  setSearchDate('others');
  loadTrips();
}

function cancelJourney(id) {
  if (confirm("Are you sure you want to cancel this trip?")) {
    const ticketIndex = tickets.findIndex(t => t.id == id);
    if (ticketIndex !== -1) {
      db.collection('tickets').doc(id.toString()).update({
        status: "CANCELLED",
        updatedAt: new Date().toISOString()
      });
      showNotification("Trip #" + id + " cancelled.", "info");
      addActivityLog(`User cancelled trip #${id}`);
      renderUpcomingJourneys();
      if (document.getElementById('userTickets').classList.contains('hidden') === false) renderTickets();
    }
  }
}

function expandTicketById(id) {
  const idx = tickets.findIndex(t => t.id == id);
  if (idx !== -1) expandTicket(idx);
}

function scheduleDepartureNotification(ticket) {
  if (!ticket.notify || !ticket.date) return;
  
  if (notificationTimeouts[ticket.id]) {
    clearTimeout(notificationTimeouts[ticket.id]);
  }

  // Parse departure. Default to 08:00 if no time set.
  const departureTime = ticket.time || "08:00";
  const departureDate = new Date(`${ticket.date}T${departureTime.includes(':') ? departureTime : '08:00'}`);
  
  if (isNaN(departureDate.getTime())) return;

  const notifyTime = departureDate.getTime() - (15 * 60 * 1000);
  const now = new Date().getTime();
  const delay = notifyTime - now;

  if (delay > 0) {
    notificationTimeouts[ticket.id] = setTimeout(() => {
      if (Notification.permission === "granted") {
        new Notification("UGBUS TICKETS Departure Alert", {
          body: `Your bus from ${ticket.from} to ${ticket.to} departs in 15 minutes!`,
          icon: 'https://cdn-icons-png.flaticon.com/512/3448/3448339.png'
        });
      }
      delete notificationTimeouts[ticket.id];
    }, delay);
  }
}

async function toggleJourneyNotify(el, ticketId) {
  const ticket = tickets.find(t => t.id == ticketId);
  if (!ticket) return;

  if (el.checked) {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      el.checked = false;
      showNotification("Notification permission denied", "error");
    } else {
      ticket.notify = true;
      localStorage.setItem("tickets", JSON.stringify(tickets));
      scheduleDepartureNotification(ticket);
      showNotification("Alerts enabled for trip #" + ticketId, "success");
    }
  } else {
    ticket.notify = false;
    localStorage.setItem("tickets", JSON.stringify(tickets));
    if (notificationTimeouts[ticketId]) {
      clearTimeout(notificationTimeouts[ticketId]);
      delete notificationTimeouts[ticketId];
    }
    showNotification("Alerts disabled", "info");
  }
}

/* AUTH METHODS */
function toggleAuthMethod(method) {
  if (method === 'phone') {
    document.getElementById('emailTab').classList.remove('active');
    document.getElementById('phoneTab').classList.add('active');
    document.querySelector('.login-form').classList.add('hidden');
    document.getElementById('phoneAuthForm').classList.remove('hidden');
  } else {
    document.getElementById('phoneTab').classList.remove('active');
    document.getElementById('emailTab').classList.add('active');
    document.getElementById('phoneAuthForm').classList.add('hidden');
    document.querySelector('.login-form').classList.remove('hidden');
  }
}

function sendOTP() {
  const phone = document.getElementById('phoneInput').value;
  if (!phone) return alert("Enter phone number");
  document.getElementById('otpInput').classList.remove('hidden');
  showNotification("OTP Sent to " + phone, "success");
  setTimeout(() => {
    document.getElementById('otpInput').value = "1234"; // Auto-fill for demo
  }, 1000);
}

/* LOGIN */
async function login(){
  let e = document.getElementById('email').value;
  let p = document.getElementById('password').value;

  try {
      await auth.signInWithEmailAndPassword(e, p);
      showNotification("Login Successful!", "success");
      document.getElementById('loginPage').classList.add("hidden");
  } catch (error) {
      alert("Error: " + error.message);
  }
}

async function register(){
  let name = regName.value;
  let email = regEmail.value;
  let phone = regPhone.value;
  let password = regPassword.value;
  let userRole = regRole.value;

  if(!name || !phone || !password || !userRole) {
    alert("Please fill in Phone, Name and Password");
    return;
  }

  try {
      const cred = await auth.createUserWithEmailAndPassword(email || `${phone}@bus.ug`, password);
      // Store user role in Firestore
      await db.collection('users').doc(cred.user.uid).set({
          name, email, phone, role: userRole, id: cred.user.uid, timestamp: new Date().toISOString()
      });
      showNotification("Registration successful!", "success");
      showLogin();
  } catch (error) {
      alert("Registration failed: " + error.message);
  }
}

function quickFill(type) {
  const emailInput = document.getElementById('email');
  const passInput = document.getElementById('password');
  if (!emailInput || !passInput) return;

  if (type === 'admin') { emailInput.value = 'admin@bus.ug'; passInput.value = '123456'; }
  else if (type === 'user') { emailInput.value = 'user@bus.ug'; passInput.value = '123456'; }
  else if (type === 'bus') { emailInput.value = 'bus@bus.ug'; passInput.value = '123456'; }
}

function togglePassword(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  if (input.type === "password") {
    input.type = "text";
    icon.classList.replace("fa-eye", "fa-eye-slash");
  } else {
    input.type = "password";
    icon.classList.replace("fa-eye-slash", "fa-eye");
  }
}

/* INIT */
function init(){
  // If we have a role, we are logged in - hide splash immediately
  if (role !== null) {
    hideSplashScreen();
  }
  
  // Set default date to today
  const today = getKampalaDateISO();
  if (document.getElementById('date')) document.getElementById('date').value = today;
  if (document.getElementById('tripDate')) document.getElementById('tripDate').value = today;

  populateCityLists();

  // Ensure app is visible and login page is hidden
  app.classList.remove("hidden");
  document.getElementById('loginPage').classList.add("hidden");
  document.getElementById('loginPage').classList.remove("login"); // Ensure login styling is removed when hidden

  userUI.classList.add("hidden"); // Hide all main UIs initially
  busUI.classList.add("hidden");
  adminUI.classList.add("hidden");

  bottomNav.classList.add("hidden"); // Hide bottom nav by default
  sidebar.classList.add("hidden"); // Hide sidebar by default
  document.getElementById('sidebarToggle').classList.add('hidden'); // Hide sidebar toggle by default
  document.getElementById('adminUserIndicator').classList.add('hidden'); // Hide admin user indicator by default
  document.getElementById('adminClock').classList.add('hidden'); // Hide admin clock by default

  if (role === 'admin') {
    document.querySelector('.topbar').classList.remove('hidden');
  } else {
    document.querySelector('.topbar').classList.add('hidden');
  }
  document.getElementById('topbarNav').classList.remove('hidden'); // Ensure topbarNav is visible

  // Handle User Header visibility and content for non-admin roles
  const userHeader = document.getElementById('userHeader');
  if (role === 'user' || role === 'bus') {
    userHeader.classList.remove('hidden');
    if (document.getElementById('welcomeName')) document.getElementById('welcomeName').innerText = currentUser.name;
    if (document.getElementById('headerProfilePic')) document.getElementById('headerProfilePic').src = currentUser.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.name)}&background=007A3D&color=fff`;
  } else {
    userHeader.classList.add('hidden');
  }

  // Back to Top functionality
  window.onscroll = function() {
    let btn = document.getElementById("backToTop");
    
    // Back to top button visibility
    if (document.body.scrollTop > 300 || document.documentElement.scrollTop > 300) btn.classList.remove("hidden");
    else btn.classList.add("hidden");
  };
  
  renderTopbarNav(); // Render topbar buttons based on role

  if (role === null) { // Guest user
    showAuthPage(); // Force login on landing
  } else if (role === "user") {
    userUI.classList.remove("hidden");
    bottomNav.classList.remove("hidden");
    renderBottomNav();
    userTab("home");
    renderRecentSearches();
    renderUpcomingJourneys();
    updateNotificationBadge();
    tickets.forEach(scheduleDepartureNotification);
  } else if (role === "bus") {
    busUI.classList.remove("hidden");
    bottomNav.classList.remove("hidden");
    renderBottomNav();
    busTab("home");
    showNotification(`Welcome, ${currentUser.name}! Manage your trips.`, "success");
  } else if (role === "admin") {
    sidebar.classList.remove("hidden");
    document.getElementById('sidebarToggle').classList.remove("hidden");
    adminUI.classList.remove("hidden");
    document.getElementById('adminClock').classList.remove('hidden');
    document.getElementById('adminUserIndicator').classList.remove('hidden');
    document.getElementById('adminUserName').innerText = currentUser.name;
    document.getElementById('adminProfilePic').src = currentUser.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.name)}&background=007A3D&color=fff`;
    bottomNav.classList.add("hidden"); // Admin doesn't use bottom nav
    startClock();
    adminTab('dashboard'); // Initialize with dashboard
    showNotification(`Welcome, ${currentUser.name}! Admin panel ready.`, "success");
  }

  // Auto-refresh UI components every second for real-time countdowns (Global)
  if (window.upcomingRefreshInterval) clearInterval(window.upcomingRefreshInterval);
  window.upcomingRefreshInterval = setInterval(() => {
      if (role === 'user' || role === null) {
          renderUpcomingJourneys();
      }
      if (role === 'bus' || role === 'admin') refreshBusSchedules();
      if (activeSearchSchedules) refreshActiveSchedules();
      
      if (role === 'admin') {
          // Refresh admin dashboard stats and booking tables in real-time
          if (!document.getElementById('adminBookings').classList.contains('hidden')) loadBookings();
          // Only reload dashboard if the dashboard panel is visible to save resources
          if (!document.getElementById('adminDashboard').classList.contains('hidden')) loadDashboard();
      }
  }, 1000);
}

/* ADMIN CLOCK */
function startClock() {
  if (window.clockInterval) clearInterval(window.clockInterval);
  
  const update = () => {
    const clockEl = document.getElementById('adminClock');
    if (clockEl) {
      const now = new Date();
      clockEl.innerHTML = `<i class="far fa-clock"></i> ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }
  };
  update();
  window.clockInterval = setInterval(update, 1000);
}

function scrollToTop() {
  window.scrollTo({top: 0, behavior: 'smooth'});
}

/* New function to show the login/register page */
function showAuthPage() {
  app.classList.add("hidden");
  document.getElementById('loginPage').classList.remove("hidden"); // loginPage is now the auth container
  document.getElementById('loginPage').classList.add("login"); // Apply login page styling

  // By default, show the login form when entering the auth page
  showLogin();
}

/* Hide the login page and return to landing */
function hideAuthPage() {
  document.getElementById('loginPage').classList.add("hidden");
  document.getElementById('loginPage').classList.remove("login");
  app.classList.remove("hidden");
  init(); // Refresh UI as guest
}

/* Render Topbar Navigation (Login/Profile/Logout) */
function renderTopbarNav() {
  let topbarActions = document.getElementById('topbarActions');
  topbarActions.innerHTML = ''; // Clear existing buttons

  if (role === null) { // Guest user
    document.getElementById('topbarNav').innerHTML = ''; // Clear any other nav items
  } else { // Logged-in user (user, bus, admin)
    // Only Admin keeps Logout in Topbar; Bus and User move to Profile
    if (role === 'admin') {
      let logoutButton = document.createElement('button');
      logoutButton.className = 'logout-btn';
      logoutButton.setAttribute('onclick', 'logout()');
      logoutButton.innerHTML = '<i class="fas fa-sign-out-alt"></i> Logout';
      topbarActions.appendChild(logoutButton);
    }

    if (role === 'user' || role === 'bus') {
      document.getElementById('topbarNav').innerHTML = ''; // Clear any other nav items
    }
  }
}

function renderBottomNav(){
  let nav = document.getElementById('bottomNav');
  nav.innerHTML = '';

  if(role === 'user' || role === null){
    nav.innerHTML = `
      <button onclick="userTab('home')" id="u1"><i class="fas fa-home"></i> Home</button>
      <button onclick="userTab('tickets')" id="u2"><i class="fas fa-ticket-alt"></i> Tickets</button>
      <button onclick="userTab('support')" id="u4"><i class="fas fa-headset"></i> Support</button>
      <button onclick="userTab('profile')" id="u3"><i class="fas fa-user"></i> Profile</button>
    `;
    // If guest, the profile button should lead to login
    if (role === null) {
      let loginBtn = nav.querySelector('#u3');
      loginBtn.setAttribute('onclick', 'showAuthPage()');
      loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
    }
  }

  if(role === 'bus'){
    nav.innerHTML = `
      <button onclick="busTab('home')" id="b1"><i class="fas fa-plus"></i> Home</button>
      <button onclick="busTab('fleet')" id="b2"><i class="fas fa-bus"></i> Fleet</button>
      <button onclick="busTab('schedules')" id="b3"><i class="fas fa-calendar"></i> Schedules</button>
      <button onclick="busTab('scanner')" id="b5"><i class="fas fa-barcode"></i> Scanner</button>
      <button onclick="busTab('profile')" id="b4"><i class="fas fa-user-cog"></i> Profile</button>
    `;
  }
}

/* SIDEBAR TOGGLE */
function toggleSidebar(){
  sidebar.classList.toggle("collapsed");
}


/* USER NAV */
function userTab(tab){
  window.scrollTo(0, 0); // Fix: Ensure content shows from the top

  // Add animation to clicked button icon
  if (typeof event !== 'undefined' && event && event.currentTarget && event.currentTarget.classList) {
    const btn = event.currentTarget;
    btn.classList.add('animate-icon');
    setTimeout(() => btn.classList.remove('animate-icon'), 300);
  }

  document.getElementById('userHome').classList.add("hidden");
  document.getElementById('userTickets').classList.add("hidden");
  document.getElementById('userProfile').classList.add("hidden");
  document.getElementById('userSupport').classList.add("hidden");

  // Remove active class from all bottom nav buttons
  document.querySelectorAll("#bottomNav button").forEach(btn => btn.classList.remove("active-tab"));

  if(tab==="home"){
    document.getElementById('userHome').classList.remove("hidden");
    document.getElementById("u1").classList.add("active-tab");
    renderUpcomingJourneys();
    // Reset to initial search screen
    document.getElementById('search-section').classList.remove('hidden');
    document.getElementById('upcomingJourneys').classList.remove('hidden');
    document.getElementById('trips').classList.add('hidden');
    document.getElementById('busDetailsBox').classList.add('hidden');
  }else if(tab==="tickets"){
    if (role === null) { // If guest, tickets require login
      showAuthPage();
      return;
    }
    document.getElementById('userTickets').classList.remove("hidden");
    document.getElementById("u2").classList.add("active-tab");
    renderTickets();
  }else if(tab==="profile"){
    if (role === null) { // If guest, profile leads to login
      showAuthPage();
      return;
    }
    document.getElementById('userProfile').classList.remove("hidden");
    document.getElementById("u3").classList.add("active-tab");
    loadProfile();
  }else if(tab==="support"){
    document.getElementById('userSupport').classList.remove("hidden");
    document.getElementById("u4").classList.add("active-tab");
    renderRefunds();
  }
}

function swapLocations() {
    const from = document.getElementById('from');
    const to = document.getElementById('to');
    const temp = from.value;
    from.value = to.value;
    to.value = temp;
    filterToCities();
}

function populateCityLists() {
    const fromList = document.getElementById('ugandaCitiesFrom');
    if (fromList) {
        // Get unique cities from the terminals collection, or fallback to default list
        let source = ugandaCitiesList;
        if (terminals.length > 0) {
            const uniqueCities = [...new Set(terminals.map(t => t.city).filter(c => c))];
            if (uniqueCities.length > 0) source = uniqueCities;
        }
        
        fromList.innerHTML = source.map(city => `<option value="${city}">`).join('');
    }
    filterToCities();
}

function filterToCities() {
    const fromEl = document.getElementById('from');
    const fromVal = fromEl ? fromEl.value : "";
    const toList = document.getElementById('ugandaCitiesTo');
    if (toList) {
        let source = ugandaCitiesList;
        if (terminals.length > 0) {
            const uniqueCities = [...new Set(terminals.map(t => t.city).filter(c => c))];
            if (uniqueCities.length > 0) source = uniqueCities;
        }

        toList.innerHTML = source
            .filter(city => city !== fromVal)
            .map(city => `<option value="${city}">`)
            .join('');
    }
}

function setSearchDate(mode) {
  const dateInput = document.getElementById('date');
  const btns = document.querySelectorAll('.date-btn');
  btns.forEach(b => b.classList.remove('active'));
  
  const today = new Date();
  if (mode === 'today') {
    document.getElementById('btnToday').classList.add('active');
    dateInput.value = getKampalaDateISO(today);
    dateInput.classList.add('hidden');
    document.getElementById('btnOthers').innerText = 'Others';
  } else if (mode === 'tomorrow') {
    document.getElementById('btnTomorrow').classList.add('active');
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1); // Increment day based on local time, then convert to Kampala ISO
    dateInput.value = getKampalaDateISO(tomorrow);
    dateInput.classList.add('hidden');
    document.getElementById('btnOthers').innerText = 'Others';
  } else if (mode === 'others') {
    document.getElementById('btnOthers').classList.add('active');
    try {
      dateInput.showPicker();
    } catch (error) {
      dateInput.classList.remove('hidden');
      dateInput.focus();
    }
  }
}

function updateOthersText() {
  const dateInput = document.getElementById('date');
  if (dateInput.value) {
    document.getElementById('btnOthers').innerText = dateInput.value;
  }
}

/* BUS NAV */
function busTab(tab){
  window.scrollTo(0, 0); // Fix: Ensure content shows from the top

  if (typeof event !== 'undefined' && event && event.currentTarget && event.currentTarget.classList) {
    const btn = event.currentTarget;
    btn.classList.add('animate-icon');
    setTimeout(() => btn.classList.remove('animate-icon'), 300);
  }

  document.getElementById('busHome').classList.add("hidden");
  document.getElementById('busFleet').classList.add("hidden");
  document.getElementById('busSchedules').classList.add("hidden");
  document.getElementById('busScanner').classList.add("hidden");
  document.getElementById('busProfile').classList.add("hidden");

  // Remove active class from all bus nav buttons
  document.querySelectorAll("#bottomNav button").forEach(btn => btn.classList.remove("active-tab"));

  if(tab==="home"){
    document.getElementById('busHome').classList.remove("hidden");
    document.getElementById('b1').classList.add("active-tab");
    loadBusSelect();
    loadHeatmap();
  }else if(tab==="fleet"){
    document.getElementById('busFleet').classList.remove("hidden");
    document.getElementById('b2').classList.add("active-tab");
    renderFleet();
  }else if(tab==="schedules"){
    document.getElementById('busSchedules').classList.remove("hidden");
    document.getElementById('b3').classList.add("active-tab");
    renderSchedules();
  }else if(tab==="scanner"){
    document.getElementById('busScanner').classList.remove("hidden");
    document.getElementById('b5').classList.add("active-tab");
  }else if(tab==="profile"){
    document.getElementById('busProfile').classList.remove("hidden");
    document.getElementById('b4').classList.add("active-tab");
    loadBusProfile();
  }
}

/* QR SCANNER LOGIC */
function startScanner() {
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    html5QrCode = new Html5Qrcode("reader");
    
    document.getElementById('startScannerBtn').classList.add('hidden');
    document.getElementById('stopScannerBtn').classList.remove('hidden');
    
    html5QrCode.start({ facingMode: "environment" }, config, (decodedText) => {
        stopScanner();
        verifyTicket(decodedText);
    }).catch(err => {
        console.error(err);
        showNotification("Camera access denied", "error");
        stopScanner();
    });
}

function stopScanner() {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            document.getElementById('startScannerBtn').classList.remove('hidden');
            document.getElementById('stopScannerBtn').classList.add('hidden');
        }).catch(err => console.log(err));
    }
}

/* HEATMAP LOGIC */
function loadHeatmap() {
    const heatmapContainer = document.getElementById('seatHeatmap');
    const busSelector = document.getElementById('heatmapBusSelector');
    
    if (busSelector.options.length === 0) {
        busSelector.innerHTML = '<option value="">All Fleet</option>';
        const operatorBuses = buses.filter(b => b.operator === currentUser.name);
        operatorBuses.forEach(b => {
            busSelector.innerHTML += `<option value="${b.name}">${b.name}</option>`;
        });
    }

    const selectedBusName = busSelector.value;
    const seatCounts = Array(17).fill(0);
    
    tickets.filter(t => !selectedBusName || t.bus === selectedBusName)
           .forEach(t => { if(t.seat) seatCounts[t.seat]++; });
    
    const max = Math.max(...seatCounts) || 1;
    
    heatmapContainer.innerHTML = '';
    for(let i=1; i<=16; i++) {
        const intensity = seatCounts[i] / max;
        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';
        cell.style.backgroundColor = `rgba(229, 62, 62, ${Math.max(0.05, intensity)})`;
        cell.innerHTML = `<small>#${i}</small><br><strong>${seatCounts[i]}</strong>`;
        heatmapContainer.appendChild(cell);
    }
}

/* TRIPS */
function loadTrips(){
  let from = document.getElementById('from').value;
  let to = document.getElementById('to').value;
  let date = document.getElementById('date') ? document.getElementById('date').value : new Date().toISOString().split('T')[0];
  let time = document.getElementById('time') ? document.getElementById('time').value : "";
  let sortOrder = document.getElementById('sortTrips') ? document.getElementById('sortTrips').value : "time";

  if(!from || !to) {
    // Only show the alert if the user is actually in the user role and on the search tab
    if (role === 'user' && !document.getElementById('trips').classList.contains('hidden')) {
        alert("Please fill in all search fields");
    }
    return;
  }
  saveRecentSearch(from, to);
  const tripsContainer = document.getElementById('trips');
  if (!tripsContainer) return;
  
  activeSearchSchedules = null; // Reset drill-down view
  tripsContainer.innerHTML = "";

  let availableTrips = trips.filter(t => 
    t.from.toLowerCase().includes(from.toLowerCase()) && 
    t.to.toLowerCase().includes(to.toLowerCase()) &&
    t.date === 'DAILY'
  );

  // Group results by Operator
  const operatorGroups = availableTrips.reduce((acc, t) => {
    if (!acc[t.busName]) acc[t.busName] = [];
    acc[t.busName].push(t);
    return acc;
  }, {});

  const operatorList = Object.keys(operatorGroups);
  const opCountText = operatorList.length > 0 ? `${operatorList.length} Operators` : 'Buses';

  showUserScreen('trips');

  const fullDate = new Date(date).toLocaleDateString('en-GB', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
  });

  const headerCard = `
    <div class="card" style="background: var(--primary); margin-bottom: 20px; border: none; padding: 20px;">
      <button class="screen-back-btn" onclick="userTab('home')" style="color: white; margin-bottom: 15px;">
        <i class="fas fa-arrow-left"></i> Back to Search
      </button>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div class="logo" style="margin: 0;">
          <img src="assests/logo.png" alt="Logo" style="width: 35px; height: 35px; object-fit: contain;">
          <h1 style="color: white; font-size: 1.2rem; margin: 0;">UGBUS TICKETS</h1>
        </div>
        <div style="text-align: right; color: white;">
          <div style="font-weight: 800; font-size: 1rem; color: var(--uganda-yellow);">${from} → ${to}</div>
          <div style="font-size: 0.75rem; opacity: 0.9;">${fullDate} | ${opCountText}</div>
        </div>
      </div>
    </div>
  `;

  tripsContainer.innerHTML = headerCard;

  if(operatorList.length === 0) {
      // Find next available date for this route
      const nextTrip = trips.filter(t => 
          t.from.toLowerCase() === from.toLowerCase() && 
          t.to.toLowerCase() === to.toLowerCase() &&
          t.date > date
      ).sort((a, b) => a.date.localeCompare(b.date))[0];

      let suggestionHtml = "";
      if (nextTrip) {
          const nextDateStr = new Date(nextTrip.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
          suggestionHtml = `
            <div style="margin-top: 20px; padding: 15px; background: rgba(252, 209, 22, 0.1); border-radius: 8px; border: 1px solid var(--uganda-yellow);">
                <p style="color: var(--uganda-yellow); margin-bottom: 10px; font-weight: 600;">Next available bus is on ${nextDateStr}</p>
                <button class="view-ticket-btn" style="margin: 0 auto; background: var(--uganda-yellow); color: var(--uganda-black);" onclick="document.getElementById('date').value='${nextTrip.date}'; loadTrips();">Switch to ${nextDateStr}</button>
            </div>`;
      }

      tripsContainer.innerHTML += `
        <div class="card" style="text-align:center; padding: 60px 20px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1);">
          <i class="fas fa-bus-slash" style="font-size: 3rem; opacity: 0.2; margin-bottom: 15px; color: white;"></i>
          <h3 style="color: white; margin-bottom: 10px;">No Buses Found</h3>
          <p style="opacity:0.7; font-size: 0.9rem; color: white;">There are no buses scheduled from <strong>${from}</strong> to <strong>${to}</strong> on this date.</p>
          ${suggestionHtml}
          <button class="view-ticket-btn" style="margin: 20px auto 0;" onclick="userTab('home')">Try Another Route or Date</button>
        </div>`;
  } else {
    operatorList.forEach(name => {
      const opTrips = operatorGroups[name];
      const searchDate = document.getElementById('date').value;
      let d = document.createElement("div");
      d.className = "upcoming-card fade-in";
      d.style.marginBottom = "12px";
      d.onclick = () => renderOperatorSchedules(name, opTrips, 'time', searchDate);
      d.innerHTML = `
        <div class="up-num"><i class="fas fa-building" style="font-size:1.2rem"></i></div>
        <div class="up-center">
          <div class="verified-badge"><i class="fas fa-check-circle"></i> Registered</div>
          <div class="up-terminal">${name}</div>
          <div class="up-route-inline">${opTrips.length} Daily Slots Found</div>
        </div>
        <div class="up-right">
          <i class="fas fa-chevron-right" style="color:var(--uganda-yellow); margin-top:5px;"></i>
        </div>
      `;
      tripsContainer.appendChild(d);
    });
  }
}

/**
 * Displays the detailed schedules for a specific operator with countdowns.
 */
function renderOperatorSchedules(operatorName, opTrips, sortOrder = 'time', searchDate) {
    activeSearchSchedules = { name: operatorName, data: opTrips, searchDate: searchDate };
    const tripsContainer = document.getElementById('trips');
    
    // Apply sorting
    if (sortOrder === 'time') {
        opTrips.sort((a, b) => getMinutesFromMidnight(a.time) - getMinutesFromMidnight(b.time));
    } else if (sortOrder === 'price') {
        opTrips.sort((a, b) => a.price - b.price);
    }
    
    const todayISO = new Intl.DateTimeFormat('en-CA', { 
        timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit' 
    }).format(new Date());

    // Format searchDate for display
    const dateParts = searchDate.split('-');
    const travelDateObj = new Date(dateParts[0], dateParts[1]-1, dateParts[2]);
    const travelDateStr = travelDateObj.toLocaleDateString('en-GB', { 
        day: '2-digit', month: 'short', year: 'numeric' 
    });
    tripsContainer.innerHTML = `
        <div class="card" style="background: rgba(255,255,255,0.05); margin-bottom: 20px; border: 1px dashed rgba(255,255,255,0.2);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                <button class="screen-back-btn" onclick="loadTrips()" style="margin: 0;">
                    <i class="fas fa-arrow-left"></i> Back
                </button>
                <div style="text-align: right; display: flex; flex-direction: column;">
                    <span style="font-size: 0.6rem; opacity: 0.6; text-transform: uppercase; color: white; margin-bottom: 2px;">Travel Date</span>
                        <div style="display: flex; align-items: center; gap: 8px; justify-content: flex-end;">
                            <span id="headerTravelDate" style="font-size: 0.85rem; font-weight: 700; color: var(--uganda-yellow);">${travelDateStr}</span>
                            <i class="fas fa-calendar-alt" style="cursor: pointer; color: white; font-size: 0.8rem;" onclick="setSearchDate('others')" title="Pick Date"></i>
                        </div>
                        <button id="switchTomorrowBtn" class="view-ticket-btn" style="margin-top: 5px; padding: 2px 8px; font-size: 0.6rem;" onclick="rebookTomorrow('${document.getElementById('from').value}', '${document.getElementById('to').value}')">Switch to Tomorrow</button>
                </div>
            </div>
            <h4 style="margin: 5px 0 0 0; color: white;">${operatorName}</h4>
            <small style="opacity: 0.7;">${document.getElementById('from').value} → ${document.getElementById('to').value}</small>
        </div>
        <div id="activeSchedulesList"></div>
    `;

    const isFutureSearch = searchDate > todayISO;

    // Initial render of static card skeletons
    const listContainer = document.getElementById('activeSchedulesList');
    listContainer.innerHTML = opTrips.map((t, index) => {
        let bTxt = isFutureSearch ? "Book For Tomorrow" : "Book Today";
        const isSoldOut = (t.availableSeats === 0);
        const soldOutBadge = isSoldOut ? `<span class="badge bg-used" style="margin-left:10px; font-size:0.6rem;">SOLD OUT</span>` : '';
        const btnDisabled = isSoldOut ? 'disabled' : '';
        const btnStyle = isSoldOut ? 'background: #718096; cursor: not-allowed; opacity: 0.7;' : 'box-shadow: 0 0 10px rgba(252, 209, 22, 0.5);';
        const btnAction = isSoldOut ? '' : `onclick='showBusDetails("${t.busName}", ${t.price}, ${JSON.stringify(t.amenities || [])}, "${t.time}")'`;
        
        return `
        <div class="upcoming-card" style="margin-bottom: 12px; background: rgba(0,0,0,0.5);">
            <div class="up-num">#${index + 1}</div>
            <div class="up-center">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <div id="time-text-${t.id}" class="up-terminal" style="margin:0;">
                        <i class="far fa-clock"></i> ${t.time} | ${t.busType}
                        <span style="margin-left: 8px; color: var(--uganda-yellow);">
                            ${(t.amenities || []).map(a => `<i class="fas fa-${a}" style="margin-right: 5px;"></i>`).join('')}
                        </span>
                    </div>
                    <div style="font-weight:bold; font-size:1rem;">UGX ${t.price.toLocaleString()} ${soldOutBadge}</div>
                </div>
                <div id="delay-info-${t.id}" style="font-size: 0.7rem; color: var(--uganda-yellow); margin-bottom: 5px;">
                    ${t.delayReason ? `<i class="fas fa-info-circle"></i> Delay: ${t.delayReason}` : ''}
                </div>
                
                <div class="progress-container">
                    <div id="bar-${t.id}" class="progress-bar" style="width: 0%; transition: width 1s linear;"></div>
                </div>
                
                <div style="display:flex; justify-content:space-between; align-items:center; gap: 10px; margin-top:5px; flex-wrap: nowrap;">
                    <span id="timer-${t.id}" style="font-size:0.75rem; color:var(--uganda-yellow); font-weight:600; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;">--m --s left</span>
                    <button id="book-btn-${t.id}" class='view-ticket-btn' style="margin:0; flex-shrink:0; ${btnStyle}" ${btnDisabled} ${btnAction}>${isSoldOut ? 'Full Capacity' : bTxt}</button>
                </div>
            </div>
        </div>
    `;
    }).join('');

    refreshActiveSchedules();

    refreshActiveSchedules();
}

/**
 * Updates the countdown and bars on the schedule results in real-time.
 */
function refreshActiveSchedules() {
    const listContainer = document.getElementById('activeSchedulesList');
    if (!listContainer || !activeSearchSchedules) return;

    const nowWall = getKampalaWallClockTime(); // Use wall clock for consistent comparison
    const windowMs = 24 * 60 * 60 * 1000;
    let allFinished = true;
    const todayISO = getKampalaDateISO();

    // Auto-update the "Travel Date" header if it exists
    const headerTravel = document.getElementById('headerTravelDate');
    if (headerTravel && activeSearchSchedules) {
        const dateParts = activeSearchSchedules.searchDate.split('-');
        const travelDateObj = new Date(dateParts[0], dateParts[1]-1, dateParts[2]);
        headerTravel.innerText = travelDateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    const searchDate = activeSearchSchedules.searchDate;
    const isFutureSearch = searchDate > todayISO;

    // Identify the Next Departure ID
    const sortedData = [...activeSearchSchedules.data].sort((a,b) => getMinutesFromMidnight(a.time) - getMinutesFromMidnight(b.time));
    const firstActiveId = sortedData.find(t => {
        const mins = getMinutesFromMidnight(t.time || "08:00 AM");
        const dateToUse = (t.date === 'DAILY') ? todayISO : t.date;
        const [y, m_val, d] = dateToUse.split('-').map(Number);
        
        const departureWall = Date.UTC(y, m_val - 1, d, Math.floor(mins / 60), mins % 60, 0);
        return (departureWall - nowWall) > -15 * 60 * 1000 && !t.manualFinished; // Consider "active" if not finished and within 15 min past
    })?.id;

    activeSearchSchedules.data.forEach((t) => {
        const mins = getMinutesFromMidnight(t.time || "08:00 AM");
        const hrs = Math.floor(mins / 60);
        const mPart = mins % 60;
        
        const dateToUse = (t.date === 'DAILY') ? todayISO : t.date;
        const [y, m_val, d] = dateToUse.split('-').map(Number);

        const departureWall = Date.UTC(y, m_val - 1, d, hrs, mPart, 0);
        const diffMs = departureWall - nowWall; // Difference in milliseconds
        
        const timerEl = document.getElementById(`timer-${t.id}`);
        const barEl = document.getElementById(`bar-${t.id}`);
        const timeTextEl = document.getElementById(`time-text-${t.id}`);
        const bookBtn = document.getElementById(`book-btn-${t.id}`);
        const delayEl = document.getElementById(`delay-info-${t.id}`);
        if (!timerEl || !barEl || !timeTextEl) return;

        let progress = 0; // Default to 0 for future trips
        const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;

        let barWidth = '0%';
        let barColor = 'var(--primary-color)'; // Default color

        // Check for manual live override from operator
        const isLive = (diffMs <= 0 && diffMs > -15 * 60 * 1000) || t.manualLive;
        const finished = diffMs <= -15 * 60 * 1000 || t.manualFinished;
        if (!finished) allFinished = false;
        const isUrgent = diffMs > 0 && diffMs < 5 * 60 * 1000;
        const isBoarding = diffMs > 0 && diffMs < 30 * 60 * 1000;
        const isNext = (t.id === firstActiveId);

        if (finished) {
            timerEl.innerHTML = `<span class="status-finished" style="font-size: 0.85rem;"><i class="fas fa-times-circle"></i> FINISHED</span>`;
            timeTextEl.classList.add('finished-schedule');
            timeTextEl.style.color = 'var(--uganda-red)';
            barEl.style.width = '100%';
            barEl.style.background = 'var(--uganda-red)'; // Finished is always red
            if (bookBtn) {
              bookBtn.innerText = "Book Tomorrow";
              bookBtn.onclick = (e) => { 
                e.stopPropagation(); 
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                const tomorrowStr = getKampalaDateISO(tomorrow);
                
                // Update travel date so booking is recorded for tomorrow
                document.getElementById('date').value = tomorrowStr;
                const btns = document.querySelectorAll('.date-btn');
                btns.forEach(b => b.classList.remove('active'));
                document.getElementById('btnOthers').classList.add('active');
                document.getElementById('btnOthers').innerText = tomorrowStr;
                
                // Proceed directly to booking details for this bus
                showBusDetails(t.busName, t.price, t.amenities, t.time);
              };
            }
        } else if (isLive) {
            statusText = `<span class="status-live" style="font-size: 0.85rem;"><span class="live-dot"></span> LIVE</span>`;
            timeTextEl.classList.remove('finished-schedule');
            timeTextEl.style.color = 'var(--uganda-yellow)';
            barWidth = '100%';
            barColor = 'var(--uganda-red)';
            if (bookBtn) {
                let bTxt = isFutureSearch ? "Book For Tomorrow" : "Book Today";
                bookBtn.innerText = bTxt;
                bookBtn.onclick = (e) => { e.stopPropagation(); showBusDetails(t.busName, t.price, t.amenities, t.time); };
            }
        } else if (isUrgent) {
            statusText = `<span class="status-urgent" style="font-size: 0.85rem;"><i class="fas fa-exclamation-triangle"></i> URGENT</span>`;
            timeTextEl.classList.remove('finished-schedule');
            timeTextEl.style.color = 'var(--uganda-yellow)';
            barWidth = Math.max(0, Math.min(100, (30 * 60 * 1000 - diffMs) / (30 * 60 * 1000) * 100)) + "%";
            barColor = 'var(--uganda-red)'; // Urgent is red
            if (bookBtn) {
                bookBtn.innerText = isFutureSearch ? "Book For Tomorrow" : "Book Today";
            }
        } else if (isBoarding) {
            statusText = `<span class="status-boarding" style="font-size: 0.85rem;"><i class="fas fa-door-open"></i> BOARDING</span>`;
            timeTextEl.classList.remove('finished-schedule');
            timeTextEl.style.color = 'var(--uganda-yellow)';
            barWidth = Math.max(0, Math.min(100, (30 * 60 * 1000 - diffMs) / (30 * 60 * 1000) * 100)) + "%";
            barColor = 'var(--uganda-yellow)';
            if (bookBtn) {
                bookBtn.innerText = isFutureSearch ? "Book For Tomorrow" : "Book Today";
            }
        } else {
            timeTextEl.classList.remove('finished-schedule');
            timeTextEl.style.color = isNext ? 'var(--uganda-yellow)' : 'white';
            const hh = String(h).padStart(2, '0');
            const mm = String(m).padStart(2, '0');
            const ss = String(s).padStart(2, '0');
            timerEl.innerHTML = `<span style="color: white; font-weight: 700;">${hh}h ${mm}m ${ss}s</span> <small style="opacity:0.7;">left</small>`;
            barColor = "var(--primary-color)"; // Default color
            if (diffMs <= windowMs) {
                barWidth = Math.max(0, Math.min(100, ((windowMs - diffMs) / windowMs) * 100)) + "%";
            } else {
                barWidth = "0%";
            }
            timeTextEl.classList.remove('finished-schedule');
            if (bookBtn) {
                bookBtn.innerText = isFutureSearch ? "Book For Tomorrow" : "Book Today";
                bookBtn.onclick = (e) => { e.stopPropagation(); showBusDetails(t.busName, t.price, t.amenities, t.time); };
            }
        }

        if (barEl) {
            barEl.style.width = barWidth;
            barEl.style.background = barColor;
        }
        if (delayEl) {
            delayEl.innerHTML = t.delayReason ? `<i class="fas fa-info-circle"></i> Delay: ${t.delayReason}` : '';
        }
    });

    // Highlight "Switch to Tomorrow" if everything today is done
    const switchBtn = document.getElementById('switchTomorrowBtn');
    if (switchBtn) {
        if (allFinished && activeSearchSchedules.data.length > 0) {
            switchBtn.classList.add('status-urgent');
            switchBtn.style.background = 'var(--uganda-red)';
            switchBtn.style.color = 'white';
        } else {
            switchBtn.classList.remove('status-urgent');
            switchBtn.style.background = '';
            switchBtn.style.color = '';
        }
    }
}

/* BUS DETAILS SCREEN */
function showBusDetails(name, price, amenities, time) {
    selectedBus = { name, price, amenities, time, duration: "3h 45m" };
    showUserScreen('busDetailsBox');
    
    document.getElementById('detailsBusName').innerText = name;
    
    const from = document.getElementById('from').value;
    const to = document.getElementById('to').value;
    
    // Simulated duration - in a real application, this would be part of the trip data
    const duration = "Est. 3h 45m";

    document.getElementById('detailsRoute').innerHTML = `
        <i class="fas fa-route"></i> ${from} → ${to} | <i class="far fa-clock" style="font-size: 0.85rem; opacity: 0.8;"></i> ${duration} | UGX ${price.toLocaleString()}
    `;
    
    document.getElementById('detailsAmenities').innerHTML = amenities.map(a => 
        `<i class="fas fa-${a}" title="${a}"></i>`
    ).join('');
}

/* BOOKING FLOW ENHANCEMENTS */
function showBoardingPoints() {
  const fromCity = document.getElementById('from').value;
  const toCity = document.getElementById('to').value;

  showUserScreen('pointsBox');
  
  // Filter points based on the cities selected in the search section
  const bSelect = document.getElementById('boardingPoint');
  const dSelect = document.getElementById('droppingPoint');
  
  const boardingOptions = terminals.filter(t => t.city === fromCity).map(t => `<option value="${t.name}">${t.name}</option>`).join('');
  const droppingOptions = terminals.filter(t => t.city === toCity).map(t => `<option value="${t.name}">${t.name}</option>`).join('');
  
  // Fallback to all points if no match is found (for robustness)
  bSelect.innerHTML = `<option value="" disabled selected hidden>Boarding Point in ${fromCity}</option>` + (boardingOptions || terminals.map(t => `<option value="${t.name}">${t.name}</option>`).join(''));
  dSelect.innerHTML = `<option value="" disabled selected hidden>Dropping Point in ${toCity}</option>` + (droppingOptions || terminals.map(t => `<option value="${t.name}">${t.name}</option>`).join(''));
}

function showPassengerInfo() {
  const bPoint = document.getElementById('boardingPoint').value;
  const dPoint = document.getElementById('droppingPoint').value;
  
  if (!bPoint || !dPoint) {
      alert("Please select both Boarding and Dropping points.");
      return;
  }

  const pCountEl = document.getElementById('passengerCount');
  const count = pCountEl ? (parseInt(pCountEl.value) || 1) : 1;
  const container = document.getElementById('passengerForms');
  // Preserve entered info: Only re-render if the passenger count has changed
  if (container.querySelectorAll('.passenger-entry').length !== count) {
    container.innerHTML = "";
    for(let i = 1; i <= count; i++) {
      container.innerHTML += `
        <div class="passenger-entry">
          <h5>Passenger ${i}</h5>
          <input placeholder="Full Name" class="p-name" required>
          <div style="position: relative;" class="phone-input-wrapper">
            <input placeholder="Contact Number" class="p-phone">
            <span class="phone-validation-indicator" style="position: absolute; right: 15px; top: 50%; transform: translateY(-50%); pointer-events: none;"></span>
          </div>
          <div style="display:flex; gap:10px;">
            <input placeholder="Age" type="number" class="p-age">
            <select class="p-gender"><option>Male</option><option>Female</option></select>
          </div>
        </div>
      `;
    }
  }

  // Attach real-time validation listeners to phone inputs (only if they haven't been attached)
  container.querySelectorAll('.passenger-entry .phone-input-wrapper').forEach(wrapper => {
    const phoneInput = wrapper.querySelector('.p-phone');
    const indicator = wrapper.querySelector('.phone-validation-indicator');

    // Check if listener already exists to prevent multiple attachments on re-render
    if (!phoneInput.dataset.listenerAttached) {
      phoneInput.oninput = () => {
        const val = phoneInput.value.trim();
        if (validateUgandaPhone(val)) {
          indicator.innerHTML = '<i class="fas fa-check-circle" style="color: #48bb78;"></i>';
        } else {
          indicator.innerHTML = val.length > 0 ? '<i class="fas fa-times-circle" style="color: #e53e3e; opacity: 0.7;"></i>' : '';
        }
      };
      phoneInput.dataset.listenerAttached = 'true'; // Mark as attached
    }
  });

  // Reset "Same as Account Holder" checkbox state
  const sameAsAccountHolderCheckbox = document.getElementById('sameAsAccountHolder');
  if (sameAsAccountHolderCheckbox) {
    sameAsAccountHolderCheckbox.checked = false;
  }

  showUserScreen('passengerBox');
}

function clearPassengerForms() {
  const container = document.getElementById('passengerForms');
  container.querySelectorAll('.passenger-entry').forEach(entry => {
    entry.querySelector('.p-name').value = '';
    entry.querySelector('.p-phone').value = '';
    entry.querySelector('.p-age').value = '';
    entry.querySelector('.p-gender').value = 'Male';
    const indicator = entry.querySelector('.phone-validation-indicator');
    if (indicator) indicator.innerHTML = '';
  });
  const sameAsAccountHolderCheckbox = document.getElementById('sameAsAccountHolder');
  if (sameAsAccountHolderCheckbox) {
    sameAsAccountHolderCheckbox.checked = false;
  }
}

function fillFromAccountHolder() {
  const checkbox = document.getElementById('sameAsAccountHolder');
  if (checkbox.checked && currentUser) {
    const firstPassengerEntry = document.querySelector('.passenger-entry');
    if (firstPassengerEntry) {
      firstPassengerEntry.querySelector('.p-name').value = currentUser.name || '';
      firstPassengerEntry.querySelector('.p-phone').value = currentUser.phone || '';
    }
  }

  showUserScreen('passengerBox');
}

function showBookingSummary() {
  const pCountEl = document.getElementById('passengerCount');
  const count = pCountEl ? (parseInt(pCountEl.value) || 1) : 1;

  const pName = document.querySelector('.p-name')?.value.trim();
  const pPhone = document.querySelector('.p-phone')?.value.trim();

  if (!pName) {
    alert("Please enter passenger name.");
    return;
  }

  if (!pPhone || !validateUgandaPhone(pPhone)) {
    alert("Please enter a valid Ugandan phone number (e.g., 07xx... or +2567xx...).");
    return;
  }

  showUserScreen('bookingConfirm');
  document.getElementById('bookingDetails').innerHTML = `
    <strong>Bus:</strong> ${selectedBus.name}<br>
    <strong>Route:</strong> ${document.getElementById('from').value} to ${document.getElementById('to').value}<br>
    <strong>Points:</strong> ${document.getElementById('boardingPoint').value} → ${document.getElementById('droppingPoint').value}<br>
    <div style="margin: 10px 0; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 8px; border-left: 4px solid var(--uganda-yellow);">
        <div style="font-size: 0.75rem; text-transform: uppercase; opacity: 0.7;">Passenger Contact</div>
        <div style="font-weight: 600;">${pName}</div>
        <div style="font-size: 0.9rem;">${pPhone}</div>
    </div>
    <strong>Total:</strong> UGX ${(selectedBus.price * count).toLocaleString()}
  `;
}

/* CONFIRM BOOKING */
async function confirmBooking(){
  if(!selectedPayment) return alert("Select payment method");
  
  const confirmBtn = document.getElementById('confirmBtn');
  const originalBtnHtml = confirmBtn.innerHTML;

  // Wait until currentUser profile is fully loaded from Firestore if the user is authenticated
  if (auth.currentUser && !currentUser) {
      let waitCount = 0;
      while (!currentUser && waitCount < 10) { // Wait up to 5 seconds
          await new Promise(r => setTimeout(r, 500));
          waitCount++;
      }
  }

  // Add loading spinner and disable button to prevent double clicks
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

  selectedSeat = 1; // Auto-assign a default seat as there is no user selection
  const ticketId = Math.floor(100000 + Math.random() * 900000);
  let ticket = { 
    bus: selectedBus?.name || "Unknown Bus", // Ensure selectedBus is defined
    time: selectedBus?.time || "08:00 AM",
    duration: selectedBus?.duration || "3h 45m",
    boardingPoint: document.getElementById('boardingPoint').value,
    droppingPoint: document.getElementById('droppingPoint').value,
    seat: selectedSeat,
    price: selectedBus?.price || 0,
    date: document.getElementById('date') ? document.getElementById('date').value : getKampalaDateISO(),
    from: document.getElementById('from').value,
    to: document.getElementById('to').value,
    payment: selectedPayment,
    passenger: document.querySelector('.p-name')?.value || currentUser?.name || "Guest",
    passengerPhone: document.querySelector('.p-phone')?.value || "",
    email: currentUser?.email || "",
    phone: currentUser?.phone || "",
    uid: currentUser ? (currentUser.uid || currentUser.id) : null,
    id: ticketId,
    status: "PENDING", // Show status pending until admin verify the payment
    timestamp: new Date().toISOString()
  };

  try {
    await db.collection('tickets').doc(ticketId.toString()).set(ticket);
    addActivityLog(`New booking: ${ticket.from} to ${ticket.to} by ${currentUser?.name || 'Guest'}`);
    
    const confirmBox = document.getElementById('bookingConfirm');
    if (confirmBox) confirmBox.classList.add("hidden");
    
    showNotification("Booking submitted! Status: PENDING verification.", "info");
    
    userTab("tickets");
  } catch (error) {
    console.error("Booking error:", error);
    showNotification("Failed to confirm booking: " + error.message, "error");
  } finally {
    // Reset button state
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = originalBtnHtml;
  }
}

/* REFUND SYSTEM */
function openRefundModal() {
    const select = document.getElementById('refundTicketSelect');
    select.innerHTML = tickets.map(t => `<option value="${t.id}">Ticket #${t.id} (${t.from}-${t.to})</option>`).join('');
    if (tickets.length === 0) return alert("No tickets available for refund.");
    document.getElementById('refundModal').classList.remove('hidden');
}

function submitRefund() {
    const ticketId = document.getElementById('refundTicketSelect').value;
    const reason = document.getElementById('refundReason').value;
    if (!reason) return alert("Please provide a reason.");
    
    const refundRequest = {
        id: Date.now(),
        ticketId: ticketId,
        reason: reason,
        status: 'Pending',
        date: new Date().toISOString()
    };
    
    refunds.push(refundRequest);
    localStorage.setItem("refunds", JSON.stringify(refunds));
    document.getElementById('refundModal').classList.add('hidden');
    showNotification("Refund request submitted successfully.", "success");
    renderRefunds();
}

function renderRefunds() {
    const container = document.getElementById('refundItems');
    const listBox = document.getElementById('refundStatusList');
    if (refunds.length > 0) listBox.classList.remove('hidden');
    container.innerHTML = refunds.map(r => `
        <div class="activity-item">
            <p><strong>ID #${r.ticketId}</strong> - Status: <span class="badge ${r.status === 'Pending' ? 'bg-primary' : 'bg-secondary'}">${r.status}</span></p>
            <small>${new Date(r.date).toLocaleDateString()}</small>
        </div>
    `).join('');
}

/* DOWNLOAD TICKET */
function downloadTicket(index){
  let t = tickets[index];
  let ticketText = `
UGBUS TICKETS Ticket
=====================
Ticket #: ${index+1}
Bus: ${t.bus}
Seat: ${t.seat}
Route: ${t.from} - ${t.to}
Date: ${t.date}
Price: UGX ${t.price.toLocaleString()}
Booked on: ${new Date(t.timestamp).toLocaleString()}
  `;
  alert("Ticket downloaded (simulated):\n" + ticketText);
}

async function shareTicket(index) {
  const t = tickets[index];
  const shareText = `My UGBUS TICKETS Ticket: ${t.from} to ${t.to} on ${t.date}. Bus: ${t.bus}, Seat: ${t.seat}.`;

  try {
    // Get ticket data for rendering
    let statusClass = "bg-secondary";
    let statusLabel = t.status || "PENDING";
    if(statusLabel === "ACTIVE") statusClass = "bg-active";
    else if(statusLabel === "VERIFIED") statusClass = "bg-active";
    else if(statusLabel === "BOARDED") statusClass = "bg-boarded";
    else if(statusLabel === "USED") statusClass = "bg-used";
    else if(statusLabel === "PAID") statusClass = "bg-paid";
    else if(statusLabel === "PENDING") statusClass = "bg-paid";

    const isUsed = statusLabel === "USED";

    const scale = 3; // 3x resolution for High Definition output
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Set canvas size for a borderless ticket (360x610 content area) multiplied by scale
    canvas.width = 360 * scale;
    canvas.height = 610 * scale;
    
    // Apply scaling to the context for high-quality rendering of text and shapes
    ctx.scale(scale, scale);

    // Store original dimensions for coordinate logic compatibility
    const origW = 400;
    const origH = 650;

    // Shift drawing context to remove margins for borderless output
    ctx.translate(-20, -20);

    // Main ticket background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(20, 20, 360, 610);

    // Header background
    ctx.fillStyle = 'rgba(0, 122, 61, 0.05)';
    ctx.fillRect(20, 20, origW - 40, 80);

    // Header bottom border
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(20, 100);
    ctx.lineTo(origW - 20, 100);
    ctx.stroke();
    ctx.setLineDash([]);

    // App Logo on Ticket
    const logoImg = new Image();
    logoImg.src = 'assests/logo.png';
    await new Promise(r => { logoImg.onload = r; logoImg.onerror = r; });
    if (logoImg.complete && logoImg.naturalWidth > 0) {
        ctx.drawImage(logoImg, 35, 35, 50, 50);
    } else {
        ctx.fillStyle = '#007A3D';
        ctx.beginPath();
        ctx.arc(60, 60, 25, 0, 2 * Math.PI);
        ctx.fill();
    }

    // Header title
    ctx.fillStyle = '#007A3D';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('UGBUS TICKETS', 100, 50);

    // Status badge
    const statusColors = {
        'ACTIVE': '#2f855a',
        'VERIFIED': '#2f855a',
        'BOARDED': '#2b6cb0',
        'USED': '#4a5568',
        'PAID': '#c05621',
        'PENDING': '#c05621'
    };
    const statusColor = statusColors[statusLabel] || '#6b7280';

    ctx.fillStyle = statusColor;
    roundRect(ctx, origW - 120, 40, 80, 25, 12);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(statusLabel, origW - 80, 55);

    // Route section
    const routeY = 130;

    // From city
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(t.from.substring(0, 3).toUpperCase(), 40, routeY);

    ctx.fillStyle = '#666666';
    ctx.font = '14px sans-serif';
    ctx.fillText(t.from, 40, routeY + 20);

    // To city
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(t.to.substring(0, 3).toUpperCase(), origW - 40, routeY);

    ctx.fillStyle = '#666666';
    ctx.font = '14px sans-serif';
    ctx.fillText(t.to, origW - 40, routeY + 20);

    // Bus icon (simple representation)
    ctx.fillStyle = '#007A3D';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🚌', origW / 2, routeY + 5);

    // Info grid
    const infoY = 200;
    const leftX = 40;
    const rightX = origW / 2 + 20;

    // Left column
    ctx.fillStyle = '#999999';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';

    ctx.fillText('PASSENGER', leftX, infoY);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(t.passenger, leftX, infoY + 15);

    ctx.fillStyle = '#999999';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('SEAT', leftX, infoY + 40);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`#${t.seat}`, leftX, infoY + 55);

    ctx.fillStyle = '#999999';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('BUS', leftX, infoY + 80);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(t.bus, leftX, infoY + 95);

    // Right column
    ctx.fillStyle = '#999999';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('PLATE', rightX, infoY);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(t.plate || 'UAX 456Z', rightX, infoY + 15);

    ctx.fillStyle = '#999999';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('DEPARTURE', rightX, infoY + 40);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`${t.date} | ${formatTimeAMPM(t.time)}`, rightX, infoY + 55);

    ctx.fillStyle = '#999999';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('BOOKING ID', rightX, infoY + 80);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`#${t.id}`, rightX, infoY + 95);

    ctx.fillStyle = '#999999';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('BOARDING', leftX, infoY + 120);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(t.boardingPoint || 'Main Terminal', leftX, infoY + 135);

    ctx.fillStyle = '#999999';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('EST. DURATION', leftX, infoY + 160);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(t.duration || '3h 45m', leftX, infoY + 175);

    // QR Code section background
    ctx.fillStyle = '#f8fafc';
    roundRect(ctx, 40, origH - 220, origW - 80, 120, 12);
    ctx.fill();

    // QR Code
    try {
        const tempDiv = document.createElement('div');
        tempDiv.style.display = 'none';
        document.body.appendChild(tempDiv);

        new QRCode(tempDiv, {
            text: `TICKET:${t.id}`,
            width: 80 * scale,
            height: 80 * scale,
            colorDark: '#000000',
            colorLight: '#ffffff'
        });

        await new Promise(resolve => setTimeout(resolve, 200));

        const qrCanvas = tempDiv.querySelector('canvas');
        if (qrCanvas) {
            ctx.drawImage(qrCanvas, origW / 2 - 40, origH - 200, 80, 80);
        }

        document.body.removeChild(tempDiv);
    } catch (qrError) {
        console.warn("QR code generation failed:", qrError);
        // Draw text QR placeholder
        ctx.fillStyle = '#000000';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`TICKET:${t.id}`, origW / 2, origH - 160);
    }

    // QR label
    ctx.fillStyle = '#64748b';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(isUsed ? 'This ticket has already been used' : 'Scan at Boarding', origW / 2, origH - 120);

    // Digital Stamp for BOARDED or USED (Physical ink stamp style with bleed and timestamp)
    if (statusLabel === 'BOARDED' || statusLabel === 'USED') {
        const vDate = new Date(t.boardedAt || t.updatedAt || t.timestamp);
        const vTimeStr = `${vDate.getDate().toString().padStart(2,'0')}/${(vDate.getMonth()+1).toString().padStart(2,'0')} ${vDate.getHours().toString().padStart(2,'0')}:${vDate.getMinutes().toString().padStart(2,'0')}`;

        ctx.save();
        ctx.translate(origW / 2, origH - 160);
        ctx.rotate(-15 * Math.PI / 180);
        ctx.globalAlpha = 1.0;
        
        // Simulation of physical ink bleed on canvas
        ctx.shadowBlur = 1.5;
        ctx.shadowColor = statusColor;

        ctx.font = '900 24px "Courier New", Courier, monospace';
        const textWidth = ctx.measureText(statusLabel).width;
        const w = Math.max(textWidth, 100) + 40;
        const h = 75;

        // Draw Oval border (Rough look with double stroke)
        ctx.strokeStyle = statusColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, 0, w/2, h/2, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fill();
        ctx.stroke();

        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, w/2 - 5, h/2 - 5, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = statusColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(statusLabel, 0, -8);

        ctx.font = 'bold 9px "Courier New", Courier, monospace';
        ctx.fillText(`VERIFIED: ${vTimeStr}`, 0, 15);

        // Add ink splatter specks
        ctx.fillStyle = statusColor;
        for (let i = 0; i < 25; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = (Math.random() * 10) + (w / 2 - 15);
            const sx = Math.cos(angle) * dist;
            const sy = Math.sin(angle) * dist;
            const size = Math.random() * 1.5;
            ctx.beginPath();
            ctx.arc(sx, sy, size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // Footer
    ctx.fillStyle = '#007A3D';
    ctx.fillRect(20, origH - 80, origW - 40, 60);

    // Footer content
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Total Fare: UGX ${t.price.toLocaleString()}`, 40, origH - 45);

    const dataUrl = canvas.toDataURL('image/png');
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], `UGBUS-TICKETS-Ticket-${t.id}.png`, { type: 'image/png' });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: 'My UGBUS TICKETS Ticket',
        text: shareText
      });
    } else {
      // Fallback: Share via WhatsApp Web/App link
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
      window.open(whatsappUrl, '_blank');
    }
  } catch (err) {
    console.error("Sharing failed:", err);
    if (navigator.share) {
      navigator.share({ title: 'My UGBUS TICKETS Ticket', text: shareText }).catch(console.error);
    } else {
      navigator.clipboard.writeText(shareText);
      showNotification("Ticket details copied to clipboard!", "success");
    }
  }
}

function trackBus(id) {
    document.getElementById('trackingView').classList.remove('hidden');
    document.getElementById('trackingETA').innerText = "ETA: 12 minutes away";
    setTimeout(() => {
        document.getElementById('trackingETA').innerText = "ETA: 8 minutes (Crossing Jinja Bridge)";
    }, 3000);
}

/* LOAD BUS SELECT */
function loadBusSelect() {
  // Find all select elements that are meant to display bus options
  const busSelectElements = document.querySelectorAll('select[id^="selectBus"], select[id="qbBus"]'); // Selects IDs starting with 'selectBus' and 'qbBus'

  busSelectElements.forEach(selectElement => {
    // Determine the default option text based on the element's original content or ID
    let defaultOptionText = "Select Bus";
    if (selectElement.id === 'selectBusAdmin') {
      defaultOptionText = "Select Any Registered Bus";
    } else if (selectElement.id === 'qbBus') {
      defaultOptionText = "Select Bus/Route";
    } else if (selectElement.id === 'selectBusBulk') {
      defaultOptionText = "Bus for Bulk Slots";
    }

    selectElement.innerHTML = `<option value="">${defaultOptionText}</option>`;
    buses.forEach(b => {
      let opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = `${b.name} (${b.route})`;
      selectElement.appendChild(opt);
    });
  });
}
/* ADD BUS */
async function addNewBus(){
  // Targeted selection within the specific form container to avoid ID collisions
  const container = document.getElementById('newBusFormContainer');
  if (!container) return;

  const nameEl = container.querySelector('#newBusName');
  const routeEl = container.querySelector('#newBusRoute');
  const priceEl = container.querySelector('#newBusPrice');
  const typeEl = container.querySelector('#newBusType');

  const name = nameEl ? nameEl.value.trim() : "";
  const route = routeEl ? routeEl.value.trim() : "";
  const priceStr = priceEl ? priceEl.value.trim() : "";
  const type = typeEl ? typeEl.value : "Standard";

  if(!name || !route || !priceStr) {
    showNotification("Please fill in the Name, Route, and Price fields.", "error");
    console.error("addNewBus validation failed: Name, Route, or Price is empty. Current values:", { name, route, priceStr }); // Debugging line
    return;
  }
  const price = parseInt(priceStr);
  if (isNaN(price) || price <= 0) {
    showNotification("Please enter a valid positive number for the Price.", "error");
    console.error("addNewBus validation failed: Price is not a valid positive number.", priceStr); // Debugging line
    return;
  }

  if(!route.includes(' - ')) {
    showNotification("Route must follow the 'City A - City B' format.", "error");
    console.error("addNewBus validation failed: Route format incorrect.", route); // Debugging line
    return;
  }

  let bus = {
    name, route, type,
    price: price, // Use the parsed integer price
    operator: currentUser ? currentUser.name : "System Admin",
    timestamp: new Date().toISOString()
  };

  try {
    await db.collection('buses').add(bus);
    addActivityLog(`New bus registered: ${name} by ${currentUser.name}`);
    nameEl.value = "";
    routeEl.value = "";
    priceEl.value = "";
    showNotification("Bus added to live fleet!", "success");
  } catch (error) {
    console.error("Firestore Error:", error);
    alert("Failed to add bus to live database.");
  }
}

/**
 * Removes a bus from the live Firestore database.
 */
async function deleteBus(busId) {
    if (confirm("Are you sure you want to remove this bus from the fleet? This will not delete past trip records.")) {
        try {
            await db.collection('buses').doc(busId).delete();
            showNotification("Bus removed from fleet", "info");
            addActivityLog(`Admin/Operator deleted bus ID: ${busId}`);
        } catch (error) {
            console.error("Delete error:", error);
            showNotification("Failed to delete bus", "error");
        }
    }
}

/* SCHEDULE TRIP */
async function scheduleTrip(){
  // Targeted selection based on the active UI to avoid ID collisions and missing elements
  const containerId = role === 'admin' ? 'adminFleetControl' : 'busHome';
  const container = document.getElementById(containerId);
  
  if (!container) {
    console.error("Schedule container not found for role:", role);
    return;
  }

  const busSelectEl = container.querySelector('select[id^="selectBus"]');
  const timeEl = container.querySelector('input[type="time"]');

  const busId = busSelectEl ? busSelectEl.value : '';
  const time = timeEl ? timeEl.value : '';

  let amenities = [];
  const wifi = container.querySelector('#wifiAmenity');
  const ac = container.querySelector('#acAmenity');
  const usb = container.querySelector('#usbAmenity');

  if(wifi && wifi.checked) amenities.push('wifi');
  if(ac && ac.checked) amenities.push('snowflake');
  if(usb && usb.checked) amenities.push('charging-station');

  if(maintenanceMode) {
    showNotification("Creation disabled: System is in Maintenance Mode.", "error");
    return;
  }

  if(!busId || !time) {
    showNotification("Please select a bus and time for daily scheduling.", "error");
    return;
  }

  let bus = buses.find(b => b.id == busId);
  if(!bus) return alert("Bus not found");

  let trip = {
    busId, busName: bus.name, 
    from: bus.route.split(' - ')[0].trim(), 
    to: bus.route.split(' - ')[1].trim(),
    date: 'DAILY', time, price: bus.price, busType: bus.type, 
    amenities,
    totalSeats: 28,
    availableSeats: 28,
    timestamp: new Date().toISOString()
  };

  try {
    await db.collection('trips').add(trip);
    addActivityLog(`Daily recurring trip scheduled for ${bus.name} at ${time}`);
    showNotification("Trip scheduled in live database!", "success");

    if (busSelectEl) busSelectEl.value = "";
    if (timeEl) timeEl.value = "";
    if (wifi) wifi.checked = false;
    if (ac) ac.checked = false;
    if (usb) usb.checked = false;
  } catch (error) {
    console.error("Firestore Error:", error);
    alert("Failed to schedule trip.");
  }
}

/* RENDER SCHEDULES */
function renderSchedules(){
  // Only target the container relevant to the current role to prevent duplicate IDs
  const containerId = (role === 'admin') ? 'schedulesAdmin' : 'schedulesBus';
  const schedulesContainer = document.getElementById(containerId);

  if (!schedulesContainer) return;
  schedulesContainer.innerHTML = "";

  if(trips.length === 0) {
    schedulesContainer.innerHTML = "<p>No trips scheduled yet.</p>";
    return;
  }

  // Group trips by Terminal (from) and Date for organized Admin View
  // Filter for daily schedules and group by Terminal city
  const groupedSchedules = trips
    .filter(t => t.date === 'DAILY')
    .reduce((acc, t) => {
        const key = t.from;
        if (!acc[key]) acc[key] = { from: t.from, slots: [] };
        acc[key].slots.push(t);
        return acc;
    }, {});

  const nowWall = getKampalaWallClockTime();
  const todayISO = getKampalaDateISO();
  const boardingWindowMs = 30 * 60 * 1000;
  const fillWindowMs = 12 * 60 * 60 * 1000;

  Object.values(groupedSchedules).forEach(group => {
    // Ensure slots are sorted by time so the earliest ones show up first
    group.slots.sort((a, b) => getMinutesFromMidnight(a.time) - getMinutesFromMidnight(b.time));

    const slotsHtml = group.slots.slice(0, 6).map(t => {
        const timeStrClean = (t.time || "08:00 AM").replace(/\s+/g, '');
        const [hPart, mFull] = timeStrClean.split(':');
        const mPart = mFull.slice(0, -2);
        const ampm = mFull.slice(-2).toUpperCase();
        let hrs = parseInt(hPart);
        if (ampm === 'PM' && hrs < 12) hrs += 12;
        if (ampm === 'AM' && hrs === 12) hrs = 0;
        const [y, m_val, d] = todayISO.split('-').map(Number);
        
        const departureWall = Date.UTC(y, m_val - 1, d, hrs, parseInt(mPart), 0);
        const diff = departureWall - nowWall;

        const isLive = (diff <= 0 && diff > -15 * 60 * 1000) || t.manualLive;
        const finished = diff <= -15 * 60 * 1000 || t.manualFinished;
        const isUrgent = diff > 0 && diff <= 5 * 60 * 1000;
        const isBoarding = diff > 0 && diff <= boardingWindowMs;

        let statusText = finished ? "FINISHED" : isLive ? "LIVE" : t.time;
        let statusColor = finished ? "var(--uganda-red)" : isLive ? "var(--uganda-yellow)" : "white";
        let pulseClass = isLive ? "pulse-live" : "";
        let barColor = finished || isLive ? "var(--uganda-red)" : isUrgent ? "var(--uganda-red)" : isBoarding ? "var(--uganda-yellow)" : "var(--primary-color)";

        return `
          <div class="${pulseClass}" style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; border-left: 3px solid ${statusColor};">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div>
                <span id="bus-timer-val-${t.id}" style="font-weight:700; color:${statusColor}">${statusText}</span>
                  <div id="bus-name-text-${t.id}" style="font-size:0.7rem; opacity:0.7;">${t.busName} (${t.availableSeats}/${t.totalSeats}) [${t.time}]</div>
                <div id="bus-delay-text-${t.id}" style="font-size: 0.6rem; color: var(--uganda-yellow); margin-top: 2px;">
                    ${t.delayReason ? `<i class="fas fa-info-circle"></i> ${t.delayReason}` : ''}
                </div>
              </div>
                <div id="bus-actions-area-${t.id}" style="display:flex; flex-direction: column; gap:4px;">
                  <div style="display:flex; gap:4px;">
                    <button class="view-ticket-btn" style="padding:2px 6px; font-size:0.5rem; background:var(--uganda-yellow); color:black;" onclick="setTripManualStatus('${t.id}', 'live')" title="Force Live">LIVE</button>
                    <button class="view-ticket-btn" style="padding:2px 6px; font-size:0.5rem; background:var(--uganda-red); color:white;" onclick="setTripManualStatus('${t.id}', 'finished')" title="Force Finish">FINISH</button>
                    <button class="view-ticket-btn" style="padding:2px 6px; font-size:0.5rem; background:#4a5568; color:white;" onclick="setTripManualStatus('${t.id}', 'reset')" title="Reset/Fresh">RESET</button>
                  </div>
                  <div style="display:flex; gap:4px;">
                    ${(!finished) ? `<button class="view-ticket-btn" style="padding:2px 6px; font-size:0.5rem; background:#2b6cb0; color:white;" onclick="updateETD('${t.id}')">ETD</button>` : ''}
                    ${role === 'admin' ? `<button class="view-ticket-btn" style="padding:2px 6px; font-size:0.5rem; background:var(--uganda-red); color:white;" onclick="deleteDailySlot('${t.id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
                  </div>
              </div>
            </div>
            <div class="progress-container" style="height:3px; margin: 5px 0;">
               <div id="bus-bar-val-${t.id}" class="progress-bar" style="width: ${finished || isLive ? '100%' : isUrgent || isBoarding ? Math.max(0, Math.min(100, ((boardingWindowMs - diff) / boardingWindowMs) * 100)) + '%' : diff <= fillWindowMs ? Math.max(0, Math.min(100, ((fillWindowMs - diff) / fillWindowMs) * 100)) + '%' : '0%'}; background: ${barColor};"></div>
            </div>
          </div>
        `;
    }).join('');

    const terminalCard = `
      <div class="card" style="border: 1px solid rgba(255,255,255,0.1);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px;">
          <h4 style="margin:0;"><i class="fas fa-hotel"></i> ${group.from} Terminal</h4>
          <span class="badge bg-active" style="font-size: 0.6rem;">DAILY RECURRING</span>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
          ${slotsHtml}
        </div>
        <div style="margin-top:15px; text-align:right;">
          <button class="view-ticket-btn" style="font-size:0.7rem;" onclick="adminTab('fleetControl')">View All Slots</button>
        </div>
      </div>
    `;
    schedulesContainer.insertAdjacentHTML('beforeend', terminalCard);
  });
}

/**
 * Updates bus operator schedules in real-time without re-rendering the whole card (stops flashing)
 */
function refreshBusSchedules() {
    if (trips.length === 0) return;

    const nowWall = getKampalaWallClockTime();
    const todayISO = getKampalaDateISO();
    const boardingWindowMs = 30 * 60 * 1000;
    const fillWindowMs = 12 * 60 * 60 * 1000;

    // Identify the "Next Departure" per terminal route to apply yellow highlighting
    const nextDepartures = trips
        .filter(t => t.date === 'DAILY')
        .reduce((acc, t) => {
            const key = `${t.from}-${t.to}`;
            const timeStrClean = (t.time || "08:00 AM").replace(/\s+/g, '');
            const [hPart, mFull] = timeStrClean.split(':');
            const mPart = mFull.slice(0, -2);
            const ampm = mFull.slice(-2).toUpperCase();
            let hrs = parseInt(hPart);
            if (ampm === 'PM' && hrs < 12) hrs += 12;
            if (ampm === 'AM' && hrs === 12) hrs = 0;
            const departureWall = Date.UTC(todayISO.split('-')[0], todayISO.split('-')[1]-1, todayISO.split('-')[2], hrs, parseInt(mPart), 0);
            
            const isFinished = (departureWall - nowWall) <= -15 * 60 * 1000;
            if (!isFinished && (!acc[key] || getMinutesFromMidnight(t.time) < getMinutesFromMidnight(acc[key].time))) {
                acc[key] = t;
            }
            return acc;
        }, {});
    const nextIds = Object.values(nextDepartures).map(t => t.id);

    trips.forEach(t => {
        // We update specific elements by ID, which is fine if they are unique per trip
        // but we need to ensure we find them in whichever container is active.
        // Since trip IDs are unique, we just look for them globally.

        const timerEl = document.getElementById(`bus-timer-val-${t.id}`);
        const barEl = document.getElementById(`bus-bar-val-${t.id}`);
        const nameEl = document.getElementById(`bus-name-text-${t.id}`);
        const actionsEl = document.getElementById(`bus-actions-area-${t.id}`);
        const busDelayEl = document.getElementById(`bus-delay-text-${t.id}`);
        
        if (!timerEl || !barEl || !nameEl || !actionsEl) return;

        const timeStrClean = (t.time || "08:00 AM").replace(/\s+/g, '');
        const [hPart, mFull] = timeStrClean.split(':');
        const mPart = mFull.slice(0, -2);
        const ampm = mFull.slice(-2).toUpperCase();
        let hrs = parseInt(hPart);
        if (ampm === 'PM' && hrs < 12) hrs += 12;
        if (ampm === 'AM' && hrs === 12) hrs = 0;
        
        const todayISO = getKampalaDateISO();
        const dateToUse = (t.date === 'DAILY') ? todayISO : t.date;
        const [y, m_val, d] = dateToUse.split('-').map(Number);

        const departureWall = Date.UTC(y, m_val - 1, d, hrs, parseInt(mPart), 0);
        const diff = departureWall - nowWall; // Difference in milliseconds

        const manualFinished = t.manualFinished || false;
        const manualLive = t.manualLive || false;

        const isLive = (diff <= 0 && diff > -15 * 60 * 1000) || manualLive;
        const finished = diff <= -15 * 60 * 1000 || manualFinished;
        const isUrgent = diff > 0 && diff < 5 * 60 * 1000;
        const isBoarding = diff > 0 && diff < 30 * 60 * 1000;
        const isNext = nextIds.includes(t.id);
        const showLateAlert = diff < -5 * 60 * 1000 && !finished && !t.manualLive;

        let statusHtml = "";
        let barWidth = "0%";
        let barColor = "var(--primary-color)";

        if (finished) {
            statusHtml = `<span class="status-finished"><i class="fas fa-times-circle"></i> FINISHED</span>`;
            timerEl.style.color = 'var(--uganda-red)';
            barWidth = "100%";
            barColor = "var(--uganda-red)";
            nameEl.classList.add('finished-schedule');
        } else {
            nameEl.classList.remove('finished-schedule');
            timerEl.style.color = (isLive || isBoarding || isUrgent || isNext) ? 'var(--uganda-yellow)' : 'white';

            if (isLive) {
                statusHtml = `<span class="status-live"><span class="live-dot"></span> LIVE</span>`;
                barWidth = "100%";
                barColor = "var(--uganda-red)";
            } else if (isUrgent) {
                statusHtml = `<span class="status-urgent"><i class="fas fa-exclamation-triangle"></i> URGENT</span>`;
                barColor = "var(--uganda-red)";
                barWidth = Math.max(0, Math.min(100, (30 * 60 * 1000 - diff) / (30 * 60 * 1000) * 100)) + "%"; // Progress within 30 min window
            } else if (isBoarding) {
                statusHtml = `<span class="status-boarding"><i class="fas fa-door-open"></i> BOARDING</span>`;
                barColor = "var(--uganda-yellow)";
                barWidth = Math.max(0, Math.min(100, (30 * 60 * 1000 - diff) / (30 * 60 * 1000) * 100)) + "%"; // Progress within 30 min window
            } else {
                const totalSec = Math.floor(diff / 1000);
                const hh = String(Math.floor((totalSec / 3600) % 24)).padStart(2, '0');
                const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
            const ss = String(totalSec % 60).padStart(2, '0'); // Pure white for numbers
            statusText = `<span style="color: white; font-weight: 700;">${hh}h ${mm}m ${ss}s</span> <small>left</small>`; // Pure white for "left"
                if (diff <= fillWindowMs) {
                    barWidth = Math.max(0, Math.min(100, ((fillWindowMs - diff) / fillWindowMs) * 100)) + "%";
                } else {
                    barWidth = "0%";
                }
                barColor = "var(--primary-color)";
            }

            if (showLateAlert) {
                statusHtml = `<span class="status-delayed-alert"><i class="fas fa-clock"></i> 5M LATE</span>`;
            }

            // Only update HTML if it changed to prevent unnecessary re-flows
            if (timerEl.innerHTML !== statusHtml) timerEl.innerHTML = statusHtml;
            barEl.style.width = barWidth;
            barEl.style.background = barColor;

            if (busDelayEl) {
                busDelayEl.innerHTML = t.delayReason ? `<i class="fas fa-info-circle"></i> ${t.delayReason}` : '';
            }

            // Handle Button visibility changes dynamically
            let actionButtonsHtml = `
                ${(!finished && !isLive) ? `<button class="view-ticket-btn" style="margin:0; background:var(--uganda-yellow); color:black;" onclick="startBoarding('${t.id}')">Start Boarding</button>` : ''}
                ${(!finished) ? `<button class="view-ticket-btn" style="margin:0; background:#2b6cb0; color:white;" onclick="updateETD('${t.id}')">Update ETD</button>` : ''}
                ${(isLive && !finished) ? `<button class="view-ticket-btn" style="margin:0; background:var(--uganda-red); color:white;" onclick="confirmDeparture('${t.id}')">Departure Confirmed</button>` : ''}
                ${role === 'admin' ? `<button class="view-ticket-btn" style="margin:0; background:var(--uganda-red); color:white;" onclick="deleteDailySlot('${t.id}')">Delete Slot</button>` : ''}
                <button class="view-ticket-btn" style="margin:0;" onclick="sendManifestToOperator('${t.busName}', '${t.date}')">SMS Manifest</button>
            `;
            if (actionsEl.innerHTML !== actionButtonsHtml) actionsEl.innerHTML = actionButtonsHtml;
        }
        });
    }

/**
 * Panic Button for Operators: Alerts Admins and specific trip passengers.
 */
async function triggerPanicButton() {
    if (!confirm("EMERGENCY: Are you sure you want to send a Panic Alert? This will notify all SmartSeat Admins and your active passengers immediately.")) return;
    
    const opName = currentUser.name;
    const todayISO = getKampalaDateISO();
    
    // Find daily trips for this operator to target passengers
    const activeTrips = trips.filter(t => t.busName === opName && t.date === 'DAILY');
    let passengerCount = 0;
    
    activeTrips.forEach(async (trip) => {
        const tripTickets = tickets.filter(tk => tk.bus === trip.busName && tk.date === todayISO && tk.status !== 'CANCELLED');
        passengerCount += tripTickets.length;
        
        tripTickets.forEach(tk => {
            dispatchMultiChannel(tk.passengerPhone || tk.phone, `EMERGENCY ALERT from ${opName}: We have encountered an incident. Stay calm, help is being notified. Ticket #${tk.id}`, ['sms', 'whatsapp']);
        });
    });

    // Notify Admins via Firestore notification
    await db.collection('notifications').add({
        title: "!!! PANIC ALERT !!!",
        message: `Operator ${opName} has triggered a Panic Button alert! Location/Route: ${activeTrips.map(t => t.from + '-' + t.to).join(', ')}`,
        timestamp: new Date().toISOString(),
        read: false,
        type: 'EMERGENCY'
    });

    showNotification("PANIC ALERT SENT! Help is on the way.", "error");
    addActivityLog(`PANIC BUTTON TRIGGERED BY OPERATOR: ${opName}`);
}

/**
 * Admin/Operator manual status override for testing or clearing stuck trips.
 */
window.setTripManualStatus = async function(tripId, status) {
    const tripRef = db.collection('trips').doc(tripId);
    let updates = {};
    
    if (status === 'live') {
        updates = { manualLive: true, manualFinished: false };
    } else if (status === 'finished') {
        updates = { manualLive: false, manualFinished: true };
    } else if (status === 'reset') {
        updates = { 
            manualLive: firebase.firestore.FieldValue.delete(), 
            manualFinished: firebase.firestore.FieldValue.delete(),
            delayReason: firebase.firestore.FieldValue.delete()
        };
    }

    try {
        await tripRef.update(updates);
        showNotification(`Trip status updated to ${status.toUpperCase()}`, "success");
    } catch (e) {
        showNotification("Failed to update status", "error");
    }
};

// New function for admin to reset trip statuses
async function resetTripStatuses() {
    if (role !== 'admin') {
        showNotification("Access Denied: Only administrators can perform this action.", "error");
        return;
    }
    if (!confirm("Are you sure you want to reset all trip statuses (manualLive, manualFinished, delayReason)? This will affect all daily recurring trips.")) {
        return;
    }

    const batch = db.batch();
    let count = 0;

    trips.forEach(t => {
        // Only reset for DAILY trips, as these are the templates
        if (t.date === 'DAILY') {
            const tripRef = db.collection('trips').doc(t.id);
            batch.update(tripRef, {
                manualLive: firebase.firestore.FieldValue.delete(), // Remove field if it exists
                manualFinished: firebase.firestore.FieldValue.delete(), // Remove field if it exists
                delayReason: firebase.firestore.FieldValue.delete() // Remove field if it exists
            });
            count++;
        }
    });

    if (count > 0) {
        await batch.commit();
        showNotification(`Successfully reset statuses for ${count} daily trips.`, "success");
            addActivityLog(`Admin reset statuses for ${count} daily trips.`);
            // Force data refresh
            if (activeSearchSchedules) loadTrips();
    } else {
        showNotification("No daily trips found to reset statuses.", "info");
    }
}

/**
 * Allows admins to delete a specific daily recurring slot from the system.
 */
window.deleteDailySlot = async function(slotId) {
    if (confirm("Are you sure you want to remove this recurring schedule slot? New trips will no longer be generated for this time.")) {
        try {
            await db.collection('trips').doc(slotId).delete();
            showNotification("Schedule slot removed", "info");
        } catch (e) { showNotification("Error removing slot", "error"); }
    }
};

/**
 * Allows an operator to adjust the departure time (ETD) for a specific daily slot.
 */
window.updateETD = async function(tripId) {
    const trip = trips.find(t => t.id === tripId);
    if (!trip) return;
    
    const newTime = prompt(`Adjust Departure Time (ETD) for ${trip.busName}:`, trip.time);
    if (newTime) {
        const reason = prompt(`Enter reason for delay (e.g. Traffic, Mechanical, Weather) - Optional:`, trip.delayReason || "");
        try {
            await db.collection('trips').doc(tripId).update({ 
                time: newTime,
                delayReason: reason || null
            });
            showNotification("Departure time adjusted successfully!", "success");
            addActivityLog(`ETD updated for ${trip.busName} to ${newTime}${reason ? ' Reason: ' + reason : ''}`);
        } catch (e) {
            showNotification("Failed to update ETD", "error");
        }
    }
};

window.toggleMaintenanceMode = async function(val) {
    try {
        await db.collection('settings').doc('config').set({ maintenanceMode: val }, { merge: true });
        showNotification(`Maintenance mode ${val ? 'enabled' : 'disabled'}`, val ? "warning" : "success");
        addActivityLog(`Admin ${val ? 'enabled' : 'disabled'} maintenance mode`);
    } catch (e) { showNotification("Failed to update status", "error"); }
};

async function startBoarding(tripId) {
    const trip = trips.find(t => t.id == tripId);
    if (trip) {
        trip.manualLive = true;
        localStorage.setItem("trips", JSON.stringify(trips));
        showNotification("Boarding started manually for " + trip.busName, "success");
        
        // Send Automated WhatsApp to passengers
        const tripTickets = tickets.filter(t => t.bus === trip.busName && t.date === trip.date && t.status !== 'CANCELLED');
        for (const t of tripTickets) {
            const contact = t.passengerPhone || t.phone;
            if (contact) {
                await dispatchMultiChannel(contact, 
                    `UGBUS TICKETS Boarding Alert: Boarding for your ${trip.busName} bus from ${trip.from} to ${trip.to} has started. Please proceed to the boarding area immediately. Ticket #${t.id}`, 
                    ['whatsapp']
                );
            }
        }
        
        renderSchedules();
    }
}

function confirmDeparture(tripId) {
    const trip = trips.find(t => t.id == tripId);
    if (trip) {
        trip.manualFinished = true;
        trip.manualLive = false;
        localStorage.setItem("trips", JSON.stringify(trips));
        showNotification("Departure confirmed for " + trip.busName, "success");
        renderSchedules();
    }
}

let clockDifferenceMonitorInterval = null;

function startClockDifferenceMonitor() {
    if (clockDifferenceMonitorInterval) clearInterval(clockDifferenceMonitorInterval);

    const clockDiffEl = document.getElementById('clockDifferenceAlert');
    if (!clockDiffEl) return;

    const updateClockDiff = () => {
        const localTime = new Date(); // Local browser time
        const kampalaTime = getKampalaDateObject(localTime); // Kampala time based on local time
        
        // To get the actual difference, we need to compare the UTC milliseconds
        const localUtcMs = localTime.getTime();
        const kampalaUtcMs = kampalaTime.getTime();

        const diffMs = localUtcMs - kampalaUtcMs; // Local - Kampala
        const diffMinutes = Math.round(diffMs / (1000 * 60));

        if (Math.abs(diffMinutes) > 5) { // Alert if difference is more than 5 minutes
            clockDiffEl.classList.remove('hidden');
            clockDiffEl.style.background = 'var(--uganda-red)';
            clockDiffEl.style.color = 'white';
            clockDiffEl.style.padding = '10px';
            clockDiffEl.style.borderRadius = '8px';
            clockDiffEl.style.marginBottom = '20px';
            clockDiffEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i> <strong>Clock Sync Warning:</strong> Your local time is ${Math.abs(diffMinutes)} minutes ${diffMinutes > 0 ? 'ahead of' : 'behind'} Kampala time. This may affect schedule accuracy.`;
        } else {
            clockDiffEl.classList.add('hidden');
        }
    };
    updateClockDiff(); // Initial check
    clockDifferenceMonitorInterval = setInterval(updateClockDiff, 30 * 1000); // Check every 30 seconds
}

/* GENERATE SEAT PREVIEW */
function generateSeatPreview(totalSeats, availableSeats) {
  let previewHtml = '';
  let occupiedSeats = totalSeats - availableSeats;
  for (let i = 0; i < totalSeats; i++) {
    if (i < occupiedSeats) {
      previewHtml += '<div class="seat-mini occupied"></div>';
    } else {
      previewHtml += '<div class="seat-mini available"></div>';
    }
  }
  return previewHtml;
}

/* RENDER TICKETS */
function renderTickets(){
  let ticketsDiv = document.getElementById('tickets');
  if (!ticketsDiv || (role !== 'user' && role !== 'admin')) return;
  
  let searchQuery = document.getElementById('ticketSearch')?.value.toLowerCase() || '';
  
  // Optimization: Only re-render if search changed or data changed (prevents shaking)
  const currentHash = searchQuery + tickets.length + tickets.map(t => t.status).join('');
  if (ticketsDiv.dataset.lastRender === currentHash) return;
  ticketsDiv.dataset.lastRender = currentHash;

  ticketsDiv.innerHTML="";
  
  let filteredTickets = tickets.filter(t => 
    t.id.toString().includes(searchQuery) || 
    t.to.toLowerCase().includes(searchQuery) ||
    t.from.toLowerCase().includes(searchQuery)
  );

  if(filteredTickets.length === 0) {
    ticketsDiv.innerHTML = "<p style='color:white;'>No boarding passes found. Start your journey today!</p>";
    return;
  }

  let table = document.createElement('table');
  table.className = 'ticket-table fade-in';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Ticket #</th>
        <th>Date</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  let tbody = table.querySelector('tbody');
  let hiddenCards = document.createElement('div');
  hiddenCards.className = 'hidden';

  filteredTickets.forEach((t, index) => {
      let statusClass = "bg-secondary";
      let statusLabel = t.status || "PENDING";
      if(statusLabel === "ACTIVE") statusClass = "bg-active";
      else if(statusLabel === "VERIFIED") statusClass = "bg-active";
      else if(statusLabel === "BOARDED") statusClass = "bg-boarded";
      else if(statusLabel === "USED") statusClass = "bg-used";
      else if(statusLabel === "PAID") statusClass = "bg-paid";
      else if(statusLabel === "PENDING") statusClass = "bg-paid";
      
      const statusColors = {
        'ACTIVE': '#2f855a', 'VERIFIED': '#2f855a', 'BOARDED': '#2b6cb0',
        'USED': '#4a5568', 'PAID': '#c05621', 'PENDING': '#c05621'
      };
      const statusColorHex = statusColors[statusLabel] || '#718096';
      const hasStamp = statusLabel === "USED" || statusLabel === "BOARDED";

      const vDate = new Date(t.boardedAt || t.updatedAt || t.timestamp);
      const vTimeStr = `${vDate.getDate().toString().padStart(2,'0')}/${(vDate.getMonth()+1).toString().padStart(2,'0')} ${vDate.getHours().toString().padStart(2,'0')}:${vDate.getMinutes().toString().padStart(2,'0')}`;

      const isUsed = statusLabel === "USED";

      // Find associated user to retrieve profile photo for design parity
      const passengerUser = users.find(u => u.email === t.email || u.name === t.passenger);
      const photoUrl = passengerUser?.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(t.passenger)}&background=007A3D&color=fff`;

      const routeTimes = [...new Set(trips
        .filter(trip => trip.from === t.from && trip.to === t.to && trip.date === 'DAILY')
        .map(trip => trip.time))]
        .sort((a, b) => a.localeCompare(b));

      const scheduleSummaryHtml = routeTimes.length > 0 ? `
        <div class="daily-schedule-summary">
          <label>Daily Route Schedule</label>
          <div class="daily-schedule-times">
            ${routeTimes.map(time => `<span class="daily-time-chip ${time === t.time ? 'active' : ''}" style="cursor:pointer;" onclick="event.stopPropagation(); initiateRebook('${t.from}', '${t.to}', '${time}')">${time}</span>`).join('')}
          </div>
        </div>` : '';

      let tr = document.createElement('tr');
      tr.onclick = () => expandTicket(index);
      tr.innerHTML = `
        <td>#${t.id}</td>
        <td>${t.date}</td>
        <td><span class="badge ${statusClass}">${statusLabel}</span></td>
      `;
      tbody.appendChild(tr);

      let d = document.createElement("div");
      d.id = `ticket-card-${index}`;
      d.innerHTML = `
        <div class="smart-ticket ${isUsed ? 'used-ticket' : ''}">
          <div class="ticket-header">
            <div style="display: flex; align-items: center; gap: 10px;">
              <img src="assests/logo.png" style="width: 35px; height: 35px; object-fit: contain;">
              <div style="font-weight:bold; color:var(--primary-color); font-size: 0.85rem;">UGBUS TICKETS</div>
            </div>
            <div class="badge ${statusClass}">${statusLabel}</div>
          </div>
          <div class="ticket-body">
            <div class="ticket-route">
              <div class="route-node"><h2>${t.from.substring(0,3).toUpperCase()}</h2><p>${t.from}</p></div>
              <div class="route-divider"><i class="fas fa-bus"></i></div>
              <div class="route-node" style="text-align:right;"><h2>${t.to.substring(0,3).toUpperCase()}</h2><p>${t.to}</p></div>
            </div>
            <div class="ticket-info-grid">
              <div class="info-item"><label>Passenger</label><span>${t.passenger}</span></div>
              <div class="info-item"><label>Bus</label><span>${t.bus}</span></div>
              <div class="info-item"><label>Departure</label><span>${t.date} | ${formatTimeAMPM(t.time)}</span></div>
              <div class="info-item"><label>Est. Duration</label><span>${t.duration || '3h 45m'}</span></div>
              <div class="info-item"><label>Boarding</label><span>${t.boardingPoint || 'Main Terminal'}</span></div>
              <div class="info-item"><label>Dropping</label><span>${t.droppingPoint || 'Destination'}</span></div>
              <div class="info-item"><label>Seat</label><span>#${t.seat || '1'}</span></div>
              <div class="info-item"><label>Booking ID</label><span>#${t.id}</span></div>
            </div>
            <div class="ticket-qr-section" style="${isUsed ? 'filter: grayscale(1); opacity: 0.5;' : ''} position: relative; overflow: hidden;">
              <div class="qr-container"></div>
              ${hasStamp ? `<div style="position: absolute; top: 45%; left: 50%; transform: translate(-50%, -50%) rotate(-15deg); border: 4px double ${statusColorHex}; color: ${statusColorHex}; padding: 12px 20px; border-radius: 50%; z-index: 5; pointer-events: none; opacity: 1.0; font-family: 'Courier New', Courier, monospace; box-shadow: inset 0 0 4px ${statusColorHex}, 0 0 1px rgba(0,0,0,0.2), 2px 2px 2px ${statusColorHex}44, -2px -2px 2px ${statusColorHex}22; white-space: nowrap; filter: blur(0.25px) contrast(140%); text-align: center; line-height: 1.1; background: rgba(255,255,255,0.98);"><div style="font-weight: 900; font-size: 1.3rem;">${statusLabel}</div><div style="font-size: 0.55rem; font-weight: bold; border-top: 1px solid ${statusColorHex}; margin-top: 2px; padding-top: 2px;">VERIFIED: ${vTimeStr}</div></div>` : ''}
              <p style="margin:5px 0 0 0; font-size:0.7rem; color:#64748b;">${isUsed ? 'This ticket has already been used' : 'Scan at Boarding'}</p>
            </div>
            ${scheduleSummaryHtml}
          </div>
          <div class="ticket-footer">
            <div>Total Fare: UGX ${t.price.toLocaleString()}</div>
            <div style="display:flex; gap:5px;">
              <button class="icon-btn" onclick="downloadTicketAsImage(${index}, event)" title="Download"><i class="fas fa-download"></i></button>
              <button class="icon-btn" onclick="shareTicket(${index})" title="Share"><i class="fas fa-share-alt"></i></button>
            </div>
          </div>
        </div>
      `;
      hiddenCards.appendChild(d);

      // Generate QR code for the hidden card so it's ready for exports (Download/Share)
      const qrTarget = d.querySelector('.qr-container');
      if (qrTarget) {
          new QRCode(qrTarget, { text: `TICKET:${t.id}`, width: 120, height: 120 });
      }
  });
  ticketsDiv.appendChild(table);
  ticketsDiv.appendChild(hiddenCards);
}

function expandTicket(index) {
    const t = tickets[index];
    const modal = document.getElementById('ticketFullscreen');
    const content = document.getElementById('fullscreenTicketContent');
    content.innerHTML = document.getElementById(`ticket-card-${index}`).innerHTML;
    // Re-generate QR for the modal since we copied HTML
    const qrContainer = content.querySelector('.qr-container');
    qrContainer.id = `qr-modal-${t.id}`;
    qrContainer.innerHTML = "";
    modal.classList.remove('hidden');
    new QRCode(qrContainer, { text: `TICKET:${t.id}`, width: 150, height: 150 });
}

function closeFullscreenTicket() {
    document.getElementById('ticketFullscreen').classList.add('hidden');
}

async function downloadTicketAsImage(index, event) {
    if(event) event.stopPropagation();

    const t = tickets[index];
    if (!t) {
        alert("Ticket not found. Please try again.");
        return;
    }

    try {
        // Get ticket data for rendering
        let statusClass = "bg-secondary";
        let statusLabel = t.status || "PENDING";
        if(statusLabel === "ACTIVE") statusClass = "bg-active";
        else if(statusLabel === "VERIFIED") statusClass = "bg-active";
        else if(statusLabel === "BOARDED") statusClass = "bg-boarded";
        else if(statusLabel === "USED") statusClass = "bg-used";
        else if(statusLabel === "PAID") statusClass = "bg-paid";
        else if(statusLabel === "PENDING") statusClass = "bg-paid";

        const isUsed = statusLabel === "USED";

        // Find associated user to retrieve profile photo
        const passengerUser = users.find(u => u.email === t.email || u.name === t.passenger);
        const photoUrl = passengerUser?.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(t.passenger)}&background=007A3D&color=fff`;

        const scale = 3; // 3x resolution for High Definition output
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Set canvas size for a borderless ticket multiplied by scale
        canvas.width = 360 * scale;
        canvas.height = 610 * scale;
        
        // Apply scaling for high-quality rendering
        ctx.scale(scale, scale);

        // Store original dimensions for coordinate logic compatibility
        const origW = 400;
        const origH = 650;

        // Shift drawing context to remove margins for borderless output
        ctx.translate(-20, -20);

        // Main ticket background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(20, 20, 360, 610);

        // Header background
        ctx.fillStyle = 'rgba(0, 122, 61, 0.05)';
        ctx.fillRect(20, 20, origW - 40, 80);

        // Header bottom border
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(20, 100);
        ctx.lineTo(origW - 20, 100);
        ctx.stroke();
        ctx.setLineDash([]);

        // App Logo on Ticket
        const logoImg = new Image();
        logoImg.src = 'assests/logo.png';
        await new Promise(r => { logoImg.onload = r; logoImg.onerror = r; });
        if (logoImg.complete && logoImg.naturalWidth > 0) {
            ctx.drawImage(logoImg, 35, 35, 50, 50);
        } else {
            ctx.fillStyle = '#007A3D';
            ctx.beginPath();
            ctx.arc(60, 60, 25, 0, 2 * Math.PI);
            ctx.fill();
        }

        // Header title
        ctx.fillStyle = '#007A3D';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('UGBUS TICKETS', 100, 50);

        // Status badge
        const statusColors = {
            'ACTIVE': '#2f855a',
            'VERIFIED': '#2f855a',
            'BOARDED': '#2b6cb0',
            'USED': '#4a5568',
            'PAID': '#c05621',
            'PENDING': '#c05621'
        };
        const statusColor = statusColors[statusLabel] || '#6b7280';

        ctx.fillStyle = statusColor;
        roundRect(ctx, origW - 120, 40, 80, 25, 12);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(statusLabel, origW - 80, 55);

        // Route section
        const routeY = 130;

        // From city
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(t.from.substring(0, 3).toUpperCase(), 40, routeY);

        ctx.fillStyle = '#666666';
        ctx.font = '14px sans-serif';
        ctx.fillText(t.from, 40, routeY + 20);

        // To city
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(t.to.substring(0, 3).toUpperCase(), origW - 40, routeY);

        ctx.fillStyle = '#666666';
        ctx.font = '14px sans-serif';
        ctx.fillText(t.to, origW - 40, routeY + 20);

        // Bus icon (simple representation)
        ctx.fillStyle = '#007A3D';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🚌', origW / 2, routeY + 5);

        // Info grid
        const infoY = 200;
        const leftX = 40;
        const rightX = origW / 2 + 20;

        // Left column
        ctx.fillStyle = '#999999';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'left';

        ctx.fillText('PASSENGER', leftX, infoY);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(t.passenger, leftX, infoY + 15);

        ctx.fillStyle = '#999999';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('SEAT', leftX, infoY + 40);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(`#${t.seat}`, leftX, infoY + 55);

        ctx.fillStyle = '#999999';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('BUS', leftX, infoY + 80);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(t.bus, leftX, infoY + 95);

        // Right column
        ctx.fillStyle = '#999999';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('PLATE', rightX, infoY);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(t.plate || 'UAX 456Z', rightX, infoY + 15);

        ctx.fillStyle = '#999999';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('DEPARTURE', rightX, infoY + 40);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(`${t.date} | ${formatTimeAMPM(t.time)}`, rightX, infoY + 55);

        ctx.fillStyle = '#999999';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('BOOKING ID', rightX, infoY + 80);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(`#${t.id}`, rightX, infoY + 95);

        ctx.fillStyle = '#999999';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('BOARDING', leftX, infoY + 120);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(t.boardingPoint || 'Main Terminal', leftX, infoY + 135);

        ctx.fillStyle = '#999999';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('EST. DURATION', leftX, infoY + 160);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(t.duration || '3h 45m', leftX, infoY + 175);

        // QR Code section background
        ctx.fillStyle = '#f8fafc';
        roundRect(ctx, 40, origH - 220, origW - 80, 120, 12);
        ctx.fill();

        // QR Code
        try {
            const tempDiv = document.createElement('div');
            tempDiv.style.display = 'none';
            document.body.appendChild(tempDiv);

            new QRCode(tempDiv, {
                text: `TICKET:${t.id}`,
                width: 80 * scale,
                height: 80 * scale,
                colorDark: '#000000',
                colorLight: '#ffffff'
            });

            await new Promise(resolve => setTimeout(resolve, 200));

            const qrCanvas = tempDiv.querySelector('canvas');
            if (qrCanvas) {
                ctx.drawImage(qrCanvas, origW / 2 - 40, origH - 200, 80, 80);
            }

            document.body.removeChild(tempDiv);
        } catch (qrError) {
            console.warn("QR code generation failed:", qrError);
            // Draw text QR placeholder
            ctx.fillStyle = '#000000';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`TICKET:${t.id}`, origW / 2, origH - 160);
        }

        // QR label
        ctx.fillStyle = '#64748b';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(isUsed ? 'This ticket has already been used' : 'Scan at Boarding', origW / 2, origH - 120);

        // Digital Stamp for BOARDED or USED (Physical ink stamp style with bleed and timestamp)
        if (statusLabel === 'BOARDED' || statusLabel === 'USED') {
            const vDate = new Date(t.boardedAt || t.updatedAt || t.timestamp);
            const vTimeStr = `${vDate.getDate().toString().padStart(2,'0')}/${(vDate.getMonth()+1).toString().padStart(2,'0')} ${vDate.getHours().toString().padStart(2,'0')}:${vDate.getMinutes().toString().padStart(2,'0')}`;

            ctx.save();
            ctx.translate(origW / 2, origH - 160);
            ctx.rotate(-15 * Math.PI / 180);
            ctx.globalAlpha = 1.0;
            
            // Simulation of physical ink bleed on canvas
            ctx.shadowBlur = 1.5;
            ctx.shadowColor = statusColor;

            ctx.font = '900 24px "Courier New", Courier, monospace';
            const textWidth = ctx.measureText(statusLabel).width;
            const w = Math.max(textWidth, 100) + 40;
            const h = 75;

            // Draw Oval border (Rough look with double stroke)
            ctx.strokeStyle = statusColor;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.ellipse(0, 0, w/2, h/2, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
            ctx.fill();
            ctx.stroke();

            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(0, 0, w/2 - 5, h/2 - 5, 0, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = statusColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(statusLabel, 0, -8);

            ctx.font = 'bold 9px "Courier New", Courier, monospace';
            ctx.fillText(`VERIFIED: ${vTimeStr}`, 0, 15);

            // Add ink splatter specks
            ctx.fillStyle = statusColor;
            for (let i = 0; i < 25; i++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = (Math.random() * 10) + (w / 2 - 15);
                const sx = Math.cos(angle) * dist;
                const sy = Math.sin(angle) * dist;
                const size = Math.random() * 1.5;
                ctx.beginPath();
                ctx.arc(sx, sy, size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        // Footer
        ctx.fillStyle = '#007A3D';
        ctx.fillRect(20, origH - 80, origW - 40, 60);

        // Footer content
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`Total Fare: UGX ${t.price.toLocaleString()}`, 40, origH - 45);

        // Download
        const dataUrl = canvas.toDataURL('image/png');
        console.log("Generated data URL length:", dataUrl.length);

        const link = document.createElement('a');
        link.download = `UGBUS-TICKETS-Ticket-${t.id}.png`;
        link.href = dataUrl;
        link.click();

    } catch (error) {
        console.error("Error generating ticket image:", error);
        // Fallback: create a simple text-based ticket
        try {
            const ticketText = `
UGBUS TICKETS
========================
Passenger: ${t.passenger}
From: ${t.from} To: ${t.to}
Date: ${t.date} Time: ${t.time || '08:00'}
Seat: #${t.seat}
Bus: ${t.bus}
Plate: ${t.plate || 'UAX 456Z'}
Booking ID: #${t.id}
Total Fare: UGX ${t.price.toLocaleString()}
Status: ${t.status || 'PENDING'}

Scan QR Code: TICKET:${t.id}
            `;

            const blob = new Blob([ticketText], { type: 'text/plain' });
            const link = document.createElement('a');
            link.download = `UGBUS-TICKETS-Ticket-${t.id}.txt`;
            link.href = URL.createObjectURL(blob);
            link.click();
            URL.revokeObjectURL(link.href);

            alert("Image download failed. Downloaded as text file instead.");
        } catch (fallbackError) {
            console.error("Fallback download also failed:", fallbackError);
            alert("Failed to download ticket. Please try again or contact support.");
        }
    }
}

// Helper function to draw rounded rectangles
function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

/* SHOW REGISTER */
function showRegister() {
  document.getElementById('loginFormCard').classList.add("hidden");
  document.getElementById('registerFormCard').classList.remove("hidden");
}

/* SHOW LOGIN */
function showLogin() {
  document.getElementById('registerFormCard').classList.add("hidden");
  document.getElementById('loginFormCard').classList.remove("hidden");
}

// Call init() on page load to start the app in guest mode
document.addEventListener('DOMContentLoaded', () => {
  init();
  window.addEventListener('click', () => {
    const dropdown = document.getElementById('notifDropdown');
    if (dropdown) dropdown.classList.remove('active');
  });
});

/* SELECT PAYMENT */
function selectPayment(method){
  selectedPayment = method;
  document.querySelectorAll('.payment-method').forEach(el => el.classList.remove('selected'));
  document.getElementById(method + 'Payment').classList.add('selected');
  document.getElementById('confirmBtn').disabled = false;
}

/* LOAD PROFILE */
function loadProfile(){
  let user = currentUser || users.find(u => u.email === TEST_USER_EMAIL);
  if(user) {
    // Ensure mandatory notification preferences are set
    user.notifyBookingConfirmations = true;
    user.notifyTripReminders = true;
    user.notifyPromotionalOffers = user.notifyPromotionalOffers !== false; // Default to true if not explicitly false

    document.getElementById('userGreeting').innerText = `Hello, ${user.name}!`;
    profileName.value = user.name;
    profileEmail.value = user.email;
    profilePhone.value = user.phone;
    localStorage.setItem("users", JSON.stringify(users)); // Save updated user preferences
  }
}

/* UPDATE PROFILE */
function updateProfile(){
  alert("Profile updated successfully!");
}
 
 // Function to update user notification preferences (if they were not mandatory)
 function updateNotificationPreferences(type, value) {
  if (currentUser) {
    currentUser[type] = value;
    localStorage.setItem("currentUser", JSON.stringify(currentUser));
    const userIndex = users.findIndex(u => u.id === currentUser.id);
    if (userIndex !== -1) users[userIndex] = currentUser;
    localStorage.setItem("users", JSON.stringify(users));
  }
}
/* TOGGLE DARK MODE */
function toggleDarkMode(){
  document.body.classList.toggle('dark-mode');
  
  // Find all theme icons (in profiles and sidebar) and update them
  const themeIcons = document.querySelectorAll('.theme-btn i, .sidebar button i.fa-moon, .sidebar button i.fa-sun, .profile-card button i');
  const isDark = document.body.classList.contains('dark-mode');
  
  themeIcons.forEach(icon => {
    icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
  });
}

/* BUS PROFILE */
function loadBusProfile(){
  let profile = JSON.parse(localStorage.getItem("busOperatorProfile") || "{}");
  document.getElementById('busCompanyName').value = profile.company || "Swift Express";
  document.getElementById('busContactEmail').value = profile.email || "bus@bus.ug";
  document.getElementById('busContactPhone').value = profile.phone || "+256 700 000 000";
  document.getElementById('busAddress').value = profile.address || "Kampala Road, Plot 12";
}

function updateBusProfile(){
  let profile = {
    company: document.getElementById('busCompanyName').value,
    email: document.getElementById('busContactEmail').value,
    phone: document.getElementById('busContactPhone').value,
    address: document.getElementById('busAddress').value
  };
  localStorage.setItem("busOperatorProfile", JSON.stringify(profile));
  showNotification("Operator profile updated!", "success");
}

/* SHOW NOTIFICATION */
function showNotification(message, type = 'info'){
  let notifications = document.getElementById('notifications');
  let notification = document.createElement('div');
  notification.className = 'notification';
  notification.innerHTML = `<i class="fas fa-info-circle"></i> ${message}`;
  notifications.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 5000);
}

function addActivityLog(message) {
  let logs = JSON.parse(localStorage.getItem("systemLogs") || "[]");
  logs.unshift({ message, time: new Date().toISOString() });
  localStorage.setItem("systemLogs", JSON.stringify(logs.slice(0, 50)));
}

function rebook(from, to){
  document.getElementById('from').value = from;
  document.getElementById('to').value = to;
  userTab('home');
  showNotification(`Route ${from} to ${to} selected! Choose your date.`, "success");
}

/* LOGOUT */
async function logout() {
  role = null;
  currentUser = null;
  await auth.signOut();
  localStorage.removeItem("currentUser");
  sessionStorage.removeItem("currentUser");
  init(); // Re-initialize the app to the guest view
}

// GLOBAL SYNC: Listen for changes from other tabs/windows
window.addEventListener('storage', (e) => {
    if (['tickets', 'trips', 'users', 'notifications', 'refunds'].includes(e.key)) {
        console.log(`[SYNC] ${e.key} updated in storage. Synchronizing UI...`);
        // The 1-second interval will pick these up and re-render the current view
        showNotification("Data updated from another session", "info");
    }
});

/* ADMIN FUNCTIONS */
function adminTab(section){
  // Hide all admin sections
  const adminSections = ['adminDashboard', 'adminUsers', 'adminOperators', 'adminRoutes', 'adminBookings', 'adminAnalytics', 'adminPayments', 'adminNotifications', 'adminSettings', 'adminActivity', 'adminSupportTickets', 'adminTicketingDesk', 'adminFleetControl', 'adminTerminals'];
  adminSections.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('hidden');
    }
  });

  // Remove active class from all admin nav buttons
  document.querySelectorAll('.sidebar button, .topbar-nav button').forEach(btn => btn.classList.remove('active-tab'));

  // Show selected section
  const sectionId = 'admin' + section.charAt(0).toUpperCase() + section.slice(1);
  const el = document.getElementById(sectionId);
  if(el) el.classList.remove('hidden');
  
  // Update Breadcrumb Trail
  const sectionLabels = {
    'dashboard': 'Dashboard',
    'users': 'User Management',
    'operators': 'Bus Operators',
    'routes': 'Route Management',
    'bookings': 'Booking Management',
    'analytics': 'Analytics',
    'payments': 'Payment Settings',
    'notifications': 'Notifications',
    'settings': 'System Settings',
    'activity': 'Activity Log',
    'supportTickets': 'Support Tickets',
    'ticketingDesk': 'Passenger Ticketing Service',
    'fleetControl': 'Fleet & Terminal Control',
    'terminals': 'Terminal Management'
  };
  title.innerHTML = `<span style="opacity: 0.6; font-weight: 400; font-size: 0.9rem;">Admin</span> <i class="fas fa-chevron-right" style="font-size: 0.7rem; margin: 0 8px; opacity: 0.4;"></i> ${sectionLabels[section] || section}`;

  // Add active class to clicked button
  if (typeof event !== 'undefined' && event && event.target) {
    let target = event.target.closest('button');
    if(target) target.classList.add('active-tab');
  } else {
    let btnId = { 'dashboard': 'a1', 'users': 'a2', 'operators': 'a3', 'routes': 'a4', 'bookings': 'a5', 'analytics': 'a6', 'payments': 'a7', 'notifications': 'a8', 'settings': 'a9', 'activity': 'a10', 'ticketingDesk': 'a11', 'fleetControl': 'a13' }[section];
    if(btnId) document.getElementById(btnId).classList.add('active-tab');
  }

  // Load data for the section
  if(section === 'dashboard') loadDashboard();
  else if(section === 'users') loadUsers();
  else if(section === 'operators') loadOperators();
  else if(section === 'routes') loadRoutes();
  else if(section === 'bookings') loadBookings();
  else if(section === 'analytics') loadAnalytics();
  else if(section === 'payments') loadPaymentSettings();
  else if(section === 'notifications') loadNotifications();
  else if(section === 'settings') loadSettings();
  else if(section === 'activity') loadActivity();
  else if(section === 'supportTickets') loadSupportTickets();
  else if(section === 'terminals') loadTerminals();
  else if(section === 'ticketingDesk') renderUpcomingJourneys();
  else if(section === 'fleetControl') { 
    renderBusRegistrationForm(); 
    loadBusSelect(); 
    renderFleet(); 
    renderSchedules(); 
  }
}

/* TERMINAL MANAGEMENT */
function loadTerminals() {
    const container = document.getElementById('adminTerminals');
    const list = document.getElementById('terminalList');
    if (!container || !list) return;

    // Inject Search Filter if not present
    if (!document.getElementById('terminalSearch')) {
        const filterHtml = `
            <div class="search-box" style="margin-bottom: 20px;">
                <i class="fas fa-search"></i>
                <input type="text" id="terminalSearch" placeholder="Filter points or cities..." 
                    oninput="terminalSearchQuery = this.value; loadTerminals();">
            </div>`;
        list.insertAdjacentHTML('beforebegin', filterHtml);
    }

    // Group terminals by city
    const grouped = terminals
      .filter(t => 
        (t.name || "").toLowerCase().includes(terminalSearchQuery.toLowerCase()) || 
        (t.city || "").toLowerCase().includes(terminalSearchQuery.toLowerCase())
      )
      .reduce((acc, t) => {
        const city = t.city || "Unassigned";
        if (!acc[city]) acc[city] = [];
        acc[city].push(t);
        return acc;
    }, {});

    list.innerHTML = Object.entries(grouped).map(([city, points]) => `
      <div style="margin-bottom: 20px;">
        <h4 style="color: var(--uganda-yellow); border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px; margin-bottom: 10px;">
            <i class="fas fa-city"></i> ${city}
        </h4>
        <table class="ticket-table">
          <thead>
            <tr><th>Point Name</th><th style="width: 80px;">Actions</th></tr>
          </thead>
          <tbody>
            ${points.map(t => `
              <tr>
                <td>${t.name}</td>
                <td><button class="btn btn-sm" style="background:var(--uganda-red)" onclick="deleteTerminal('${t.id}')"><i class="fas fa-trash"></i></button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `).join('');
}

async function addTerminal() {
    const cityInput = document.getElementById('newTerminalCity');
    const nameInput = document.getElementById('newTerminalName');
    const city = cityInput.value.trim();
    const name = nameInput.value.trim();
    if (!name || !city) return alert("Enter both city and point name");
    
    try {
        await db.collection('terminals').add({ name, city, timestamp: new Date().toISOString() });
        nameInput.value = "";
        cityInput.value = "";
        showNotification("Terminal point added!", "success");
    } catch (e) { alert(e.message); }
}

async function deleteTerminal(id) {
    if (confirm("Delete this point?")) {
        try {
            await db.collection('terminals').doc(id).delete();
        } catch (e) { alert(e.message); }
    }
}

/**
 * Checks if a date falls within the selected admin range
 */
function isWithinDateRange(checkDate) {
  const start = document.getElementById('revenueStart')?.value;
  const end = document.getElementById('revenueEnd')?.value;
  if (!start && !end) return true;
  if (start && checkDate < start) return false;
  if (end && checkDate > end) return false;
  return true;
}

/**
 * Issues a ticket manually from the admin panel
 */
function adminQuickBook() {
  const name = document.getElementById('qbName').value;
  const phone = document.getElementById('qbPhone').value;
  const busId = document.getElementById('qbBus').value;
  const date = document.getElementById('qbDate').value;
  const time = document.getElementById('qbTime').value;
  const bus = buses.find(b => b.id == busId);

  if(!name || !phone || !bus || !date || !time) return alert("Please fill all fields to issue a ticket.");

  const ticket = {
    id: Math.floor(100000 + Math.random() * 900000),
    bus: bus.name, seat: 1, price: bus.price, date: date, time: time,
    from: bus.route.split(' - ')[0], to: bus.route.split(' - ')[1],
    payment: "ADMIN_MANUAL", passenger: name, passengerPhone: phone,
    email: "admin@smartseat.ug", status: "ACTIVE", timestamp: new Date().toISOString()
  };

  tickets.push(ticket);
  localStorage.setItem("tickets", JSON.stringify(tickets));
  showNotification(`Ticket #${ticket.id} issued for ${name}`, "success");
  addActivityLog(`Admin issued manual ticket #${ticket.id}`);
  adminTab('bookings');
}

function toggleBulkTripSelect() {
    const type = document.getElementById('notificationType').value;
    const group = document.getElementById('bulkTripSelectGroup');
    const routeGroup = document.getElementById('routeSelectGroup');
    
    group.classList.toggle('hidden', type !== 'trip');
    routeGroup.classList.toggle('hidden', type !== 'route');

    if (type === 'trip') {
        const select = document.getElementById('targetTripSelect');
        select.innerHTML = trips.map(t => `<option value="${t.id}">${t.busName}: ${t.from}-${t.to} (${t.date})</option>`).join('');
    }
}

function loadDashboard(){
  // Update dashboard stats
  document.getElementById('statUsers').textContent = users.length.toLocaleString();
  document.getElementById('statBuses').textContent = buses.length.toLocaleString();
  document.getElementById('statBookings').textContent = tickets.length.toLocaleString();
  document.getElementById('statTrips').textContent = trips.length.toLocaleString();

  // Calculate Cancellation
  const cancelledCount = tickets.filter(t => t.status === 'CANCELLED').length;
  const cancelRate = tickets.length > 0 ? Math.round((cancelledCount / tickets.length) * 100) : 0;
  document.getElementById('statCancelled').textContent = cancelledCount;
  document.getElementById('statCancelled').nextElementSibling.textContent = `Cancellation rate: ${cancelRate}%`;
  
  // Calculate revenue
  let revenue = tickets.reduce((sum, ticket) => sum + (ticket.price || 0), 0);
  document.getElementById('statRevenue').textContent = 'UGX ' + revenue.toLocaleString();

  // Calculate Today's Check-ins (Kampala Time)
  const todayISO = getKampalaDateISO();
  const todayTickets = tickets.filter(t => t.date === todayISO && t.status !== 'CANCELLED');
  const boardedCount = todayTickets.filter(t => ['BOARDED', 'USED'].includes(t.status)).length;
  const totalToday = todayTickets.length;
  const statCheckIn = document.getElementById('statCheckIn');
  if (statCheckIn) {
      statCheckIn.textContent = `${boardedCount} / ${totalToday}`;
  }

  // Booking Distribution (Occupancy)
  const totalSeatsAcrossFleet = trips.length * 28;
  const occupiedSeats = trips.reduce((acc, t) => acc + (28 - (t.availableSeats || 0)), 0);
  const occupancyPerc = totalSeatsAcrossFleet > 0 ? Math.round((occupiedSeats / totalSeatsAcrossFleet) * 100) : 0;
  const distInner = document.getElementById('bookingDistributionInner');
  if (distInner) distInner.textContent = `${occupancyPerc}% Full`;

  // Charts (Real-time distribution)
  const revenueChart = document.getElementById('revenueTrendChart');
  if (revenueChart) {
      // Group by last 4 dates present in tickets
      const revByDate = tickets.reduce((acc, t) => { acc[t.date] = (acc[t.date] || 0) + (t.price || 0); return acc; }, {});
      const sortedDates = Object.keys(revByDate).sort().slice(-4);
      const maxRev = Math.max(...Object.values(revByDate), 1);
      revenueChart.innerHTML = sortedDates.map(d => `<div class="bar" style="height: ${(revByDate[d]/maxRev)*100}%;" title="${d}"></div>`).join('');
  }

  const growthChart = document.getElementById('userGrowthChart');
  if (growthChart) {
      // Simply display relative volume of users vs target for visualization
      const growthData = [30, 50, 45, 80]; // Mocking growth trend for UI feel
      growthChart.innerHTML = growthData.map(h => `<div class="bar" style="height: ${h}%; background: #4a5568;"></div>`).join('');
  }

  // --- NEW: Calculate revenue per bus ---
  const revenueByBus = tickets.reduce((acc, t) => {
    const busName = t.bus || 'Unknown Bus';
    acc[busName] = (acc[busName] || 0) + (t.price || 0);
    return acc;
  }, {});

  // Inject Admin Control buttons if they don't exist
  const container = document.getElementById('adminDashboard');
  
  // Create or Update Revenue Breakdown Card
  let revBreakdown = document.getElementById('revBreakdownCard');
  if (container && !revBreakdown) {
    revBreakdown = document.createElement('div');
    revBreakdown.id = 'revBreakdownCard';
    revBreakdown.className = 'card';
    revBreakdown.style.marginTop = '20px';
    container.appendChild(revBreakdown);
  }

  if (revBreakdown) {
    const sortedRev = Object.entries(revenueByBus).sort((a, b) => b[1] - a[1]);
    revBreakdown.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
        <h3 style="margin:0;"><i class="fas fa-coins"></i> Revenue by Bus</h3>
        <span class="badge bg-active" style="font-size: 0.6rem;">REAL-TIME</span>
      </div>
      <div style="max-height: 250px; overflow-y: auto;">
        ${sortedRev.length === 0 ? '<p style="opacity:0.6;">No sales recorded yet.</p>' : 
          sortedRev.map(([name, rev]) => `
            <div style="display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
              <span style="font-size:0.95rem;">${name}</span>
              <strong style="color:var(--uganda-yellow);">UGX ${rev.toLocaleString()}</strong>
            </div>
          `).join('')}
      </div>
    `;
  }

  if (container && !document.getElementById('adminSeedBtn')) {
    adminActionSection = document.createElement('div');
    adminActionSection.id = 'adminActionSection';
    adminActionSection.style.margin = '20px 0';
    adminActionSection.innerHTML = `
      <h4 style="color:white; margin-bottom:10px;"><i class="fas fa-tools"></i> Admin Maintenance</h4>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <button id="adminSeedBtn" class="view-ticket-btn" style="margin:0; background:var(--uganda-yellow); color:black;" onclick="seedFirestore()">
          <i class="fas fa-calendar-plus"></i> Populate Schedule
        </button>
        <button class="view-ticket-btn" style="margin:0; background:var(--uganda-red); color:white;" onclick="deleteExpiredTrips()">
          <i class="fas fa-trash-alt"></i> Delete Old Trips
        </button>
        <button class="btn" style="margin:0; background:#2b6cb0; color:white; grid-column: span 2;" onclick="resetTripStatuses()">
          <i class="fas fa-sync-alt"></i> Reset All Trip Statuses
        </button>
      </div>
    `;
    container.appendChild(adminActionSection);
  } else if (adminActionSection) {
      // Ensure the clock difference alert is present if the section already exists
      if (!document.getElementById('clockDifferenceAlert')) {
          const clockDiffDiv = document.createElement('div');
          clockDiffDiv.id = 'clockDifferenceAlert';
          clockDiffDiv.className = 'hidden';
          clockDiffDiv.style.marginBottom = '15px';
          adminActionSection.insertBefore(clockDiffDiv, adminActionSection.children[1]); // Insert after h4
      }
  }
  startClockDifferenceMonitor(); // Start monitoring when dashboard loads
}

function loadUsers(){
  let userList = document.getElementById('userList');
  userList.innerHTML = '';
  
  let query = document.getElementById('userSearch') ? document.getElementById('userSearch').value.toLowerCase() : '';
  
  let filteredUsers = users.filter(user => 
    user.name.toLowerCase().includes(query) || 
    user.email.toLowerCase().includes(query)
  );
  
  userList.innerHTML = `
    <table class="ticket-table">
      <thead>
        <tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Actions</th></tr>
      </thead>
      <tbody>
        ${filteredUsers.map(u => `
          <tr>
            <td>${u.name}</td><td>${u.email}</td><td>${u.phone}</td><td>${u.role}</td>
            <td><button class="btn btn-sm" style="background:var(--uganda-red)" onclick="deleteUser(${u.id})"><i class="fas fa-trash"></i></button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function loadOperators(){
  let operatorList = document.getElementById('operatorList');
  operatorList.innerHTML = '';
  
  // Get all unique operators defined in users or buses
  let operators = [...new Set([...buses.map(b => b.operator), ...users.filter(u => u.role === 'bus').map(u => u.name)])];
  
  operatorList.innerHTML = `
    <table class="ticket-table">
      <thead>
        <tr><th>Operator Name</th><th>Fleet Size</th><th>Actions</th></tr>
      </thead>
      <tbody>
        ${operators.map(op => `
          <tr>
            <td>${op}</td>
            <td>${buses.filter(b => b.operator === op).length} Buses</td>
            <td><button class="btn btn-sm" onclick="adminTab('fleetControl')"><i class="fas fa-cog"></i> Manage</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function loadRoutes(){
  let routeList = document.getElementById('routeList');
  routeList.innerHTML = '';
  
  // Get unique routes from trips
  let routes = [];
  trips.forEach(trip => {
    let routeKey = `${trip.from}-${trip.to}`;
    if(!routes.find(r => r.key === routeKey)){
      routes.push({
        key: routeKey,
        from: trip.from,
        to: trip.to,
        price: trip.price,
        bookings: tickets.filter(t => t.from === trip.from && t.to === trip.to).length
      });
    }
  });
  
  routeList.innerHTML = `
    <table class="ticket-table">
      <thead>
        <tr><th>Route</th><th>Base Price</th><th>Bookings</th><th>Actions</th></tr>
      </thead>
      <tbody>
        ${routes.map(r => `
          <tr>
            <td>${r.from} → ${r.to}</td>
            <td>UGX ${r.price.toLocaleString()}</td>
            <td>${r.bookings}</td>
            <td><button class="btn btn-sm" onclick="editRoute('${r.key}')"><i class="fas fa-edit"></i></button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function loadSupportTickets() {
    const container = document.getElementById('adminRefundList');
    container.innerHTML = '';
    if (refunds.length === 0) {
        container.innerHTML = '<p>No pending refund requests found.</p>';
        return;
    }
    container.innerHTML = `
      <table class="ticket-table">
        <thead>
          <tr><th>Ticket</th><th>Passenger</th><th>Reason</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          ${refunds.map(r => {
            const t = tickets.find(ticket => ticket.id == r.ticketId);
            return `<tr>
              <td>#${r.ticketId}</td><td>${t ? t.passenger : 'N/A'}</td><td>${r.reason}</td>
              <td><span class="badge ${r.status === 'Pending' ? 'bg-paid' : 'bg-used'}">${r.status}</span></td>
              <td>
                ${r.status === 'Pending' ? `<button class="btn btn-sm" style="background:#48bb78;" onclick="updateRefundStatus(${r.id}, 'Approved')">Verify</button>` : ''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
}

function updateRefundStatus(id, status) {
    const refund = refunds.find(r => r.id === id);
    if (refund) {
        refund.status = status;
        localStorage.setItem("refunds", JSON.stringify(refunds));
        showNotification(`Refund request ${status.toLowerCase()}!`, "success");
        loadSupportTickets();
        addActivityLog(`Refund request #${id} was ${status.toLowerCase()}`);
    }
}

/**
 * Sends the entire passenger list to the bus operator via SMS.
 * Critical for operators without smartphones.
 */
async function sendManifestToOperator(busName, date) {
    const busTickets = tickets.filter(t => t.bus === busName && t.date === date && t.status !== 'CANCELLED');
    const operatorPhone = "+256700000000"; // This should be fetched from the bus operator's profile
    
    if (busTickets.length === 0) return alert("No passengers booked for this trip.");

    let manifest = `MANIFEST: ${busName} (${date})\n`;
    busTickets.forEach(t => {
        manifest += `S:${t.seat}-ID:${t.id}\n`;
    });

    await sendSMS(operatorPhone, manifest);
    alert("Manifest sent to operator's phone via SMS!");
}

function loadBookings(){
  let bookingList = document.getElementById('bookingList');
  if(!bookingList) return;
  let filter = document.getElementById('bookingFilter')?.value || 'all';
  let searchQuery = document.getElementById('bookingSearch')?.value.toLowerCase() || '';

  bookingList.innerHTML = '';
  
  let filteredTickets = tickets.filter(t => {
    const statusMatch = (filter === 'all' || t.status === filter);
    const dateMatch = isWithinDateRange(t.date);
    const searchMatch = t.id.toString().includes(searchQuery) || 
                        t.passenger.toLowerCase().includes(searchQuery);
    return statusMatch && dateMatch && searchMatch;
  });

  // Update the visual chart
  renderRevenueChart(filteredTickets);

  bookingList.innerHTML = `
    <table class="ticket-table">
      <thead>
        <tr><th>ID</th><th>Passenger</th><th>Route</th><th>Price</th><th>Status</th><th>Actions</th></tr>
      </thead>
      <tbody>
        ${filteredTickets.map(t => `
          <tr>
            <td>#${t.id}</td><td>${t.passenger}</td><td>${t.from} → ${t.to}</td>
            <td>${t.price.toLocaleString()}</td>
            <td>
              <span class="badge ${t.status === 'PENDING' ? 'bg-paid' : t.status === 'ACTIVE' ? 'bg-active' : t.status === 'BOARDED' ? 'bg-boarded' : 'bg-used'}">${t.status}</span>
            </td>
            <td style="display:flex; gap:5px;">
              ${t.status === 'PENDING' ? `<button class="btn btn-sm" style="background:#48bb78" onclick="updateTicketStatus(${t.id}, 'ACTIVE')" title="Verify Payment & Set Active"><i class="fas fa-check"></i></button>` : ''}
              ${t.status === 'ACTIVE' ? `<button class="btn btn-sm" style="background:#f6ad55" onclick="updateTicketStatus(${t.id}, 'BOARDED')" title="Manual Terminal Boarding"><i class="fas fa-id-card-clip"></i></button>` : ''}
              ${t.status === 'BOARDED' ? `<button class="btn btn-sm" style="background:#4299e1" onclick="updateTicketStatus(${t.id}, 'USED')" title="Mark Trip Finished"><i class="fas fa-check-double"></i></button>` : ''}
              ${t.status === 'USED' ? `<button class="btn btn-sm" style="background:#718096" onclick="updateTicketStatus(${t.id}, 'PENDING')" title="Reset to Pending"><i class="fas fa-undo"></i></button>` : ''}
              <button class="btn btn-sm" style="background:var(--uganda-black)" onclick="printTicketReceipt(${t.id})"><i class="fas fa-print"></i></button>
              <button class="btn btn-sm" style="background:var(--uganda-red)" onclick="cancelBooking(${t.id})"><i class="fas fa-trash"></i></button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

/**
 * Toggles auto-refresh for the admin booking list
 */
function toggleAdminRefresh() {
  const isEnabled = document.getElementById('adminAutoRefresh').checked;
  if (isEnabled) {
    showNotification("Auto-refresh enabled (5s)", "info");
    adminRefreshInterval = setInterval(loadBookings, 5000);
  } else {
    showNotification("Auto-refresh disabled", "info");
    clearInterval(adminRefreshInterval);
    adminRefreshInterval = null;
  }
}

/**
 * Renders a visual bar chart of daily revenue
 */
function renderRevenueChart(filteredData) {
  const chartContainer = document.getElementById('bookingRevenueChart');
  if (!chartContainer) return;

  // Group revenue by date
  const dailyData = filteredData.reduce((acc, t) => {
    if (!acc[t.date]) acc[t.date] = { revenue: 0, count: 0 };
    acc[t.date].revenue += (t.price || 0);
    acc[t.date].count += 1;
    return acc;
  }, {});

  const dates = Object.keys(dailyData).sort();
  const maxRev = Math.max(...Object.values(dailyData).map(d => d.revenue), 1);

  if (dates.length === 0) {
    chartContainer.innerHTML = '<p style="font-size: 0.8rem; opacity: 0.5;">No revenue data for selected filters.</p>';
    return;
  }

  chartContainer.innerHTML = dates.map(date => {
    const amount = dailyData[date].revenue;
    const height = (amount / maxRev) * 100;
    const displayDate = date.split('-').slice(1).join('/'); // MM/DD
    return `
      <div style="display: flex; flex-direction: column; align-items: center; min-width: 40px;">
        <div class="bar" style="height: ${height}%; width: 25px;" title="UGX ${amount.toLocaleString()} | ${dailyData[date].count} tickets on ${date}"></div>
        <span style="font-size: 0.6rem; margin-top: 5px; opacity: 0.7; color: white;">${displayDate}</span>
      </div>
    `;
  }).join('');
}

/**
 * Generates a printable receipt for a ticket
 */
async function printTicketReceipt(id) {
    const t = tickets.find(ticket => ticket.id == id);
    if (!t) return;

    // Find associated user to retrieve profile photo for identity verification
    const passengerUser = users.find(u => u.email === t.email || u.name === t.passenger);
    const photoUrl = passengerUser?.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(t.passenger)}&background=007A3D&color=fff`;

    // Add 'Verified by Admin' stamp for manually issued tickets
    const adminStamp = t.payment === "ADMIN_MANUAL" ? 
        `<div style="position: absolute; bottom: 80px; right: 20px; transform: rotate(-15deg); border: 3px solid #E53E3E; color: #E53E3E; padding: 5px 10px; border-radius: 5px; font-weight: 800; text-transform: uppercase; font-size: 0.8rem; z-index: 10; background: rgba(255,255,255,0.9); pointer-events: none;">Verified by Admin</div>` : '';

    // Create the high-fidelity HTML matching the passenger's Smart Ticket
    const statusLabel = t.status || "PAID";
    const statusClass = statusLabel === "ACTIVE" ? "bg-active" : statusLabel === "BOARDED" ? "bg-boarded" : statusLabel === "USED" ? "bg-used" : "bg-paid";

    const statusColors = {
        'ACTIVE': '#2f855a', 'VERIFIED': '#2f855a', 'BOARDED': '#2b6cb0',
        'USED': '#4a5568', 'PAID': '#c05621', 'PENDING': '#c05621'
    };
    const statusColorHex = statusColors[statusLabel] || '#718096';
    const hasStamp = statusLabel === "USED" || statusLabel === "BOARDED";

    const vDate = new Date(t.boardedAt || t.updatedAt || t.timestamp);
    const vTimeStr = `${vDate.getDate().toString().padStart(2,'0')}/${(vDate.getMonth()+1).toString().padStart(2,'0')} ${vDate.getHours().toString().padStart(2,'0')}:${vDate.getMinutes().toString().padStart(2,'0')}`;

    const printHtml = `
        <html>
        <head>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap" rel="stylesheet">
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
            <style>
                body { font-family: 'Inter', sans-serif; padding: 20px; display: flex; justify-content: center; background: #f8fafc; }
                .smart-ticket { background: white; color: #2d3748; border-radius: 20px; width: 400px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); position: relative; }
                .ticket-header { padding: 15px 20px; background: rgba(0, 122, 61, 0.05); display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #e2e8f0; }
                .ticket-body { padding: 20px; }
                .ticket-route { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
                .route-node h2 { margin: 0; font-size: 1.5rem; font-weight: 800; color: #1a202c; }
                .route-node p { margin: 0; font-size: 0.8rem; color: #718096; }
                .route-divider { flex: 1; text-align: center; color: #007A3D; font-size: 1.2rem; }
                .ticket-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px; }
                .info-item label { display: block; font-size: 0.7rem; text-transform: uppercase; color: #718096; letter-spacing: 1px; }
                .info-item span { font-weight: 700; font-size: 0.95rem; }
                .ticket-footer { padding: 15px 20px; background: #007A3D; color: white; display: flex; justify-content: space-between; align-items: center; font-weight: bold; }
                .ticket-qr-section { text-align: center; padding: 20px; background: #f8fafc; border-radius: 12px; margin-top: 15px; position: relative; }
                .badge { padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: bold; }
                .bg-active { background: #48bb78; color: white; }
                .bg-paid { background: #ed8936; color: white; }
                @media print { body { background: none; padding: 0; } .smart-ticket { border: none; box-shadow: none; } }
            </style>
        </head>
        <body onload="window.print(); window.close();">
            <div class="smart-ticket">
                ${adminStamp}
                <div class="ticket-header">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <img src="assests/logo.png" style="width: 50px; height: 50px; object-fit: contain;" alt="Logo">
                        <div>
                            <div style="font-weight:bold; color:#007A3D; line-height: 1.2;">UGBUS TICKETS</div>
                            <div style="font-size: 0.65rem; color: #718096; text-transform: uppercase; letter-spacing: 0.5px;">Identity Verified</div>
                        </div>
                    </div>
                    <div class="badge ${statusClass}">${statusLabel}</div>
                </div>
                <div class="ticket-body">
                    <div class="ticket-route">
                        <div class="route-node"><h2>${t.from.substring(0,3).toUpperCase()}</h2><p>${t.from}</p></div>
                        <div class="route-divider"><i class="fas fa-bus"></i></div>
                        <div class="route-node" style="text-align:right;"><h2>${t.to.substring(0,3).toUpperCase()}</h2><p>${t.to}</p></div>
                    </div>
                    <div class="ticket-info-grid">
                        <div class="info-item"><label>Passenger</label><span>${t.passenger}</span></div>
                        <div class="info-item"><label>Seat</label><span>#${t.seat || '1'}</span></div>
                        <div class="info-item"><label>Bus</label><span>${t.bus}</span></div>
                        <div class="info-item"><label>Departure</label><span>${t.date} | ${formatTimeAMPM(t.time)}</span></div>
                        <div class="info-item"><label>Est. Duration</label><span>${t.duration || '3h 45m'}</span></div>
                        <div class="info-item"><label>Boarding</label><span>${t.boardingPoint || 'Main Terminal'}</span></div>
                        <div class="info-item"><label>Dropping</label><span>${t.droppingPoint || 'Destination'}</span></div>
                    </div>
                    <div class="ticket-qr-section">
                        <div style="border: 2px solid #e2e8f0; border-radius: 8px; width: 100px; height: 100px; margin: 0 auto; display: flex; align-items: center; justify-content: center; background: white; color: #cbd5e0; font-size: 2rem;"><i class="fas fa-qrcode"></i></div>
                        ${hasStamp ? `<div style="position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%) rotate(-15deg); border: 4px double ${statusColorHex}; color: ${statusColorHex}; padding: 12px 20px; border-radius: 50%; opacity: 1.0; font-family: 'Courier New', Courier, monospace; box-shadow: inset 0 0 4px ${statusColorHex}, 2px 2px 2px ${statusColorHex}44; white-space: nowrap; filter: blur(0.25px) contrast(140%); text-align: center; line-height: 1.1; background: rgba(255,255,255,0.98);"><div style="font-weight: 900; font-size: 1.3rem;">${statusLabel}</div><div style="font-size: 0.55rem; font-weight: bold; border-top: 1px solid ${statusColorHex}; margin-top: 2px; padding-top: 2px;">VERIFIED: ${vTimeStr}</div></div>` : ''}
                        <p style="margin:8px 0 0 0; font-size:0.7rem; color:#64748b;">${statusLabel === 'USED' ? 'This ticket has already been used' : 'Scan at Boarding'}</p>
                    </div>
                </div>
                <div class="ticket-footer">
                    <div>Fare: UGX ${t.price.toLocaleString()}</div>
                    <div>ID: #${t.id}</div>
                </div>
            </div>
        </body>
        </html>`;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(printHtml);
    printWindow.document.close();
    addActivityLog(`Admin printed high-fidelity receipt for Ticket #${id}`);
}

/**
 * Updates all filtered tickets with 'PAID' status to 'VERIFIED' at once.
 */
async function bulkVerifyPayments() {
  let filter = document.getElementById('bookingFilter')?.value || 'all';
  let targetTickets = filter === 'all' ? tickets : tickets.filter(t => t.status === filter);
  let pendingTickets = targetTickets.filter(t => t.status === 'PENDING');

  if (pendingTickets.length === 0) {
    showNotification("No 'PENDING' tickets found in current view.", "info");
    return;
  }

  if (confirm(`Are you sure you want to verify all ${pendingTickets.length} pending payments?`)) {
    const batch = db.batch();
    pendingTickets.forEach(t => {
        const ref = db.collection('tickets').doc(t.id.toString());
        batch.update(ref, { status: 'ACTIVE', updatedAt: new Date().toISOString() });
    });
    
    await batch.commit();
    showNotification(`Successfully verified ${paidTickets.length} tickets!`, "success");
  }
}

/**
 * Generates a printable Revenue Report based on the current filtered list.
 */
function generateRevenueReport() {
  let filter = document.getElementById('bookingFilter')?.value || 'all';
  let filteredTickets = tickets.filter(t => {
    const statusMatch = (filter === 'all' || t.status === filter);
    const dateMatch = isWithinDateRange(t.date);
    return statusMatch && dateMatch;
  });
  let totalRevenue = filteredTickets.reduce((sum, t) => sum + (t.price || 0), 0);
  
  // Calculate counts per day
  const dailyGroups = filteredTickets.reduce((acc, t) => {
    acc[t.date] = (acc[t.date] || 0) + 1;
    return acc;
  }, {});

  let reportDate = new Date().toLocaleDateString();

  const reportHtml = `
    <div style="font-family: 'Inter', sans-serif; padding: 30px; color: #333; max-width: 800px; margin: auto;">
      <div style="border-bottom: 2px solid #007A3D; padding-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
        <h2 style="color: #007A3D; margin: 0;">UGBUS TICKETS Revenue Report</h2>
        <span>Generated: ${reportDate}</span>
      </div>
      <p style="margin-top: 20px;"><strong>Status:</strong> ${filter.toUpperCase()}</p>
      <p><strong>Period:</strong> ${document.getElementById('revenueStart')?.value || 'Start'} to ${document.getElementById('revenueEnd')?.value || 'End'}</p>
      <p><strong>Total Issued Tickets:</strong> ${filteredTickets.length}</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
        <tr style="background: #f4f4f4; text-align: left;">
          <th style="padding: 10px; border: 1px solid #ddd;">ID</th>
          <th style="padding: 10px; border: 1px solid #ddd;">Passenger</th>
          <th style="padding: 10px; border: 1px solid #ddd;">Route</th>
          <th style="padding: 10px; border: 1px solid #ddd;">Date</th>
          <th style="padding: 10px; border: 1px solid #ddd;">Amount</th>
        </tr>
        ${filteredTickets.map(t => `
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">#${t.id}</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${t.passenger}</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${t.from} → ${t.to}</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${t.date}</td>
            <td style="padding: 10px; border: 1px solid #ddd;">UGX ${(t.price || 0).toLocaleString()}</td>
          </tr>`).join('')}
      </table>
      <div style="margin-top: 20px; border-top: 1px solid #ddd; padding-top: 10px;">
        <h4>Daily Breakdown (Ticket Count):</h4>
        <ul style="list-style: none; padding: 0;">
          ${Object.entries(dailyGroups).map(([date, count]) => `
            <li style="display: flex; justify-content: space-between; padding: 5px 0;">
              <span>${date}</span>
              <strong>${count} tickets</strong>
            </li>`).join('')}
        </ul>
      </div>
      <h3 style="text-align: right; margin-top: 30px;">Total Revenue: UGX ${totalRevenue.toLocaleString()}</h3>
    </div>`;

  const printWin = window.open('', '_blank');
  printWin.document.write('<html><head><title>Revenue Report</title></head><body onload="window.print(); window.close();">' + reportHtml + '</body></html>');
  printWin.document.close();
}

function exportRevenueToCSV() {
  let filter = document.getElementById('bookingFilter')?.value || 'all';
  let filteredTickets = tickets.filter(t => {
    const statusMatch = (filter === 'all' || t.status === filter);
    const dateMatch = isWithinDateRange(t.date);
    return statusMatch && dateMatch;
  });
  let csv = "ID,Date,Passenger,Route,Price,Status\n";
  filteredTickets.forEach(t => csv += `${t.id},${t.date},${t.passenger},${t.from}-${t.to},${t.price},${t.status}\n`);
  let blob = new Blob([csv], { type: 'text/csv' });
  let url = window.URL.createObjectURL(blob);
  let a = document.createElement('a');
  a.href = url; a.download = `revenue_report_${new Date().toISOString().split('T')[0]}.csv`; a.click();
}

function resendTicketSMS(ticketId) {
    const t = tickets.find(ticket => ticket.id == ticketId);
    if (t) dispatchMultiChannel(t.phone || currentUser.phone, formatTicketSMS(t));
}

async function updateTicketStatus(id, newStatus) {
    try {
        await db.collection('tickets').doc(id.toString()).update({
            status: newStatus,
            updatedAt: new Date().toISOString()
        });
        showNotification(`Ticket #${id} updated to ${newStatus}`, "success");
    } catch (error) {
        console.error("Error updating ticket:", error);
        showNotification("Failed to update ticket status", "error");
    }
}

function assignOperator(id) {
    const op = document.getElementById(`opAssign-${id}`).value;
    if (op) {
        db.collection('tickets').doc(id.toString()).update({
            status: "ACTIVE",
            assignedOperator: op,
            updatedAt: new Date().toISOString()
        }).then(() => {
            showNotification(`Ticket assigned to ${op}`, "success");
        });
    }
}

function loadActivity(){
  let activityLog = document.getElementById('fullActivityLog');
  let logs = JSON.parse(localStorage.getItem("systemLogs") || "[]");
  
  if(logs.length === 0) {
    activityLog.innerHTML = "<p style='padding: 20px;'>No recent activity recorded.</p>";
    return;
  }

  activityLog.innerHTML = logs.map(log => `
    <div class="activity-item">
      <i class="fas fa-circle-notch fa-spin" style="font-size: 0.8rem;"></i> ${log.message} 
      <span class="time">${new Date(log.time).toLocaleTimeString()}</span>
    </div>
  `).join('');
}

function loadAnalytics(){
  // This would typically load charts and analytics data
  // For now, just update the popular routes
  let routeStats = {};
  tickets.forEach(ticket => {
    let route = `${ticket.from}-${ticket.to}`;
    routeStats[route] = (routeStats[route] || 0) + 1;
  });
  
  let sortedRoutes = Object.entries(routeStats).sort((a,b) => b[1] - a[1]);
  let popularRoutesDiv = document.getElementById('popularRoutes');
  popularRoutesDiv.innerHTML = '';
  
  sortedRoutes.slice(0, 3).forEach(([route, count], index) => {
    let routeName = route.replace('-', ' → ');
    popularRoutesDiv.innerHTML += `<p>${index + 1}. ${routeName} (${count} bookings)</p>`;
  });
}

function exportUsers(){
  let csv = "Name,Email,Phone,Role\n";
  users.forEach(u => csv += `${u.name},${u.email},${u.phone},${u.role}\n`);
  let blob = new Blob([csv], { type: 'text/csv' });
  let url = window.URL.createObjectURL(blob);
  let a = document.createElement('a');
  a.href = url; a.download = 'ugbus_users.csv'; a.click();
}

/**
 * Injects the Register New Bus form into the Admin UI if it doesn't exist.
 */
function renderBusRegistrationForm() {
    const container = document.getElementById('adminFleetControl');
    if (!container || document.getElementById('newBusFormContainer')) return;

    const formHtml = `
        <div id="newBusFormContainer" class="card" style="margin-bottom: 25px; border-left: 5px solid var(--primary-color);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3 style="margin: 0;"><i class="fas fa-plus-circle"></i> Register New Bus</h3>
                <span class="badge bg-active" style="font-size: 0.6rem;">LIVE DATABASE</span>
            </div>
            <div class="grid-form" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                <div class="form-group">
                    <label style="font-size: 0.75rem; opacity: 0.8;">Bus Operator Name</label>
                    <input type="text" id="newBusName" placeholder="e.g. Swift Express">
                </div>
                <div class="form-group">
                    <label style="font-size: 0.75rem; opacity: 0.8;">Primary Route</label>
                    <input type="text" id="newBusRoute" placeholder="Format: Kampala - Jinja">
                </div>
                <div class="form-group">
                    <label style="font-size: 0.75rem; opacity: 0.8;">Default Price (UGX)</label>
                    <input type="number" id="newBusPrice" placeholder="25000">
                </div>
                <div class="form-group">
                    <label style="font-size: 0.75rem; opacity: 0.8;">Service Class</label>
                    <select id="newBusType">
                        <option value="Standard">Standard</option>
                        <option value="Luxury">Luxury</option>
                        <option value="Executive">Executive</option>
                    </select>
                </div>
            </div>
            <button type="button" class="view-ticket-btn" style="margin-top: 15px; width: 100%; background: var(--primary-color);" onclick="addNewBus()">
                <i class="fas fa-save"></i> Save to Live Fleet
            </button>
        </div>
    `;
    container.insertAdjacentHTML('afterbegin', formHtml);
}

function renderFleet(){
  // Only target the container relevant to the current role to prevent duplicate IDs
  const containerId = (role === 'admin') ? 'fleetAdmin' : 'fleetBus';
  const fleetDiv = document.getElementById(containerId);

  if (!fleetDiv) return;
  fleetDiv.innerHTML = "";
  
  // Admin sees all buses, Operators see only theirs
  const visibleBuses = role === 'admin' ? buses : buses.filter(b => b.operator === currentUser.name);

  if(visibleBuses.length === 0) {
    fleetDiv.innerHTML = "<p>No buses in fleet yet.</p>";
    return;
  }

  const fleetHtml = visibleBuses.map(b => `
      <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h4 style="margin:0;">${b.name}</h4>
          <p style="margin:5px 0;">Route: ${b.route}</p>
          <p style="margin:5px 0;">Type: ${b.type} | UGX ${b.price.toLocaleString()}</p>
          ${role === 'admin' ? `<p style="font-size:0.8rem; color:var(--uganda-yellow); margin:0;">Operator: ${b.operator}</p>` : ''}
        </div>
        <button class="btn btn-sm" style="background:var(--uganda-red); padding: 8px 12px;" onclick="deleteBus('${b.id}')">
          <i class="fas fa-trash"></i>
        </button>
      </div>
      </div>
    `).join('');
    
  fleetDiv.innerHTML = fleetHtml;
}

function loadPaymentSettings(){
  // Load current payment settings from localStorage or set defaults
  let settings = JSON.parse(localStorage.getItem('paymentSettings') || '{"mtn": true, "airtel": true, "card": true}');
  document.getElementById('mtnEnabled').checked = settings.mtn;
  document.getElementById('airtelEnabled').checked = settings.airtel;
  document.getElementById('cardEnabled').checked = settings.card;
}

function loadNotifications(){
  // This section is for sending notifications, no loading needed
}

function loadSettings(){
  // Load current settings from localStorage or set defaults
  let settings = JSON.parse(localStorage.getItem('appSettings') || '{"appName": "UGBUS TICKETS", "supportEmail": "support@ugbus.ug", "supportPhone": "+256 414 123 456", "bookingFee": 2}');
  document.getElementById('appName').value = settings.appName;
  document.getElementById('supportEmail').value = settings.supportEmail;
  document.getElementById('supportPhone').value = settings.supportPhone;
  document.getElementById('bookingFee').value = settings.bookingFee;
}

/* ADMIN ACTION FUNCTIONS */
function addRoute(){
  let from = document.getElementById('newRouteFrom').value;
  let to = document.getElementById('newRouteTo').value;
  let price = document.getElementById('routePrice').value;
  
  if(!from || !to || !price) {
    alert('Please fill all fields');
    return;
  }
  
  // Add a sample trip for this route
  let newTrip = {
    id: Date.now(),
    from: from,
    to: to,
    date: getKampalaDateISO(),
    time: '08:00',
    price: parseInt(price),
    bus: 'New Route Bus',
    seats: 50,
    available: 50
  };
  
  trips.push(newTrip);
  localStorage.setItem('trips', JSON.stringify(trips));
  
  alert('Route added successfully!');
  document.getElementById('newRouteFrom').value = '';
  document.getElementById('newRouteTo').value = '';
  document.getElementById('routePrice').value = '';
  loadRoutes();
}

function savePaymentSettings(){
  let settings = {
    mtn: document.getElementById('mtnEnabled').checked,
    airtel: document.getElementById('airtelEnabled').checked,
    card: document.getElementById('cardEnabled').checked
  };
  
  localStorage.setItem('paymentSettings', JSON.stringify(settings));
  alert('Payment settings saved!');
}

function sendNotification(){
  let type = document.getElementById('notificationType').value;
  let title = document.getElementById('notificationTitle').value;
  let message = document.getElementById('notificationMessage').value;

  if(type === 'trip') {
      const tripId = document.getElementById('targetTripSelect').value;
      const trip = trips.find(t => t.id == tripId);
      if(!trip) return alert("Select a valid trip");
      
      const tripTickets = tickets.filter(t => t.bus === trip.busName && t.date === trip.date && t.status !== 'CANCELLED');
      
      if(confirm(`Send this update to ${tripTickets.length} passengers via SMS/WhatsApp?`)) {
          db.collection('broadcasts').add({
              title: title,
              message: message,
              type: 'Trip Bulk',
              target: `${trip.busName} (${trip.date})`,
              recipientCount: tripTickets.length,
              timestamp: new Date().toISOString()
          });
          tripTickets.forEach(t => {
              dispatchMultiChannel(t.phone || t.email, `URGENT: ${title} - ${message}`);
          });
          showNotification(`Bulk update sent to ${tripTickets.length} passengers`, "success");
          addActivityLog(`Bulk notification sent for trip ${trip.busName} on ${trip.date}`);
      }
      return;
  } else if (type === 'route') {
      const from = document.getElementById('emergencyFrom').value;
      const to = document.getElementById('emergencyTo').value;
      if (!from || !to) return alert("Please specify route cities.");

      const routeTickets = tickets.filter(t => t.from === from && t.to === to && ["PENDING", "ACTIVE", "PAID", "VERIFIED", "BOARDED"].includes(t.status));
      
      if(confirm(`Send Emergency SMS to all ${routeTickets.length} passengers on the ${from} to ${to} route?`)) {
          db.collection('broadcasts').add({
              title: title,
              message: message,
              type: 'Emergency Route',
              target: `${from} to ${to}`,
              recipientCount: routeTickets.length,
              timestamp: new Date().toISOString()
          });
          routeTickets.forEach(t => {
              dispatchMultiChannel(t.passengerPhone || t.phone, `EMERGENCY: ${title} - ${message}`);
          });
          showNotification(`Emergency alert sent to ${routeTickets.length} passengers`, "success");
          addActivityLog(`Emergency SMS sent for route ${from}-${to}`);
      }
      return;
  }
  
  if(!title || !message) {
    alert('Please fill all fields');
    return;
  }
  
  let notification = {
    id: Date.now(),
    type: type,
    title: title,
    message: message,
    timestamp: new Date().toISOString(),
    read: false
  };
  
  notifications.push(notification);
  localStorage.setItem('notifications', JSON.stringify(notifications));
  updateNotificationBadge();
  
  alert('Notification sent successfully!');
  document.getElementById('notificationTitle').value = '';
  document.getElementById('notificationMessage').value = '';
}

/**
 * Renders the history of emergency and bulk broadcasts in the Admin panel.
 */
function renderBroadcastHistory() {
    const tbody = document.getElementById('broadcastHistoryBody');
    if (!tbody) return;
    
    if (broadcasts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; opacity:0.5;">No history available</td></tr>';
        return;
    }

    tbody.innerHTML = broadcasts.map(b => `
        <tr>
            <td>${new Date(b.timestamp).toLocaleDateString()} ${new Date(b.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
            <td><span class="badge ${b.type.includes('Emergency') ? 'bg-used' : 'bg-boarded'}" style="font-size:0.55rem;">${b.type}</span><br><small>${b.target}</small></td>
            <td title="${b.message}">${b.title}</td>
            <td style="text-align:center; font-weight:bold;">${b.recipientCount}</td>
        </tr>
    `).join('');
}

/**
 * Deletes all trips from Firestore that are in the past.
 */
async function deleteExpiredTrips() {
    if (role !== 'admin') return;
    if (!confirm("Are you sure you want to delete all expired trips? This action cannot be undone.")) return;

    const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Africa/Kampala"}));
    const batch = db.batch();
    let count = 0;

    trips.forEach(t => {
        const [hPart, mFull] = (t.time || "08:00 AM").split(':');
        const [mPart, ampm] = mFull.split(' ');
        let hrs = parseInt(hPart);
        if (ampm === 'PM' && hrs < 12) hrs += 12;
        if (ampm === 'AM' && hrs === 12) hrs = 0;
        
        if (t.date === 'DAILY') return; // Do not delete recurring daily schedules
        const [y, m_val, d] = t.date.split('-').map(Number);
        const departure = new Date(y, m_val - 1, d, hrs, parseInt(mPart), 0, 0);

        if (departure < (now - 30 * 60 * 1000)) {
            batch.delete(db.collection('trips').doc(t.id));
            count++;
        }
    });

    if (count > 0) {
        await batch.commit();
        showNotification(`Maintenance: Deleted ${count} expired trips.`, "success");
        addActivityLog(`Admin deleted ${count} expired trips.`);
    } else {
        showNotification("No expired trips found to clean up.", "info");
    }
}

function saveSettings(){
  let settings = {
    appName: document.getElementById('appName').value,
    supportEmail: document.getElementById('supportEmail').value,
    supportPhone: document.getElementById('supportPhone').value,
    bookingFee: document.getElementById('bookingFee').value
  };
  
  localStorage.setItem('appSettings', JSON.stringify(settings));
  alert('Settings saved successfully!');
}

/**
 * Seeds the Firestore database with sample trips based on standard operators.
 */
async function seedFirestore() {
  if (role !== 'admin') {
    alert("Access Denied: Only administrators can initialize the database.");
    return;
  }
  
  if (!confirm("This will add sample bus routes to your live database. Continue?")) return;

  const batch = db.batch();
  const todayISO = getKampalaDateISO();

  standardOperators.forEach(op => {
    standardTimes.forEach(time => {
      const tripRef = db.collection('trips').doc();
      batch.set(tripRef, {
        busName: op.name,
        from: op.from,
        to: op.to,
        date: 'DAILY',
        time: time,
        price: op.price,
        busType: op.type,
        amenities: op.am,
        totalSeats: 28,
        availableSeats: Math.floor(Math.random() * 15) + 5,
        timestamp: new Date().toISOString()
      });
    });
  });

  try {
    await batch.commit();
    showNotification("Firestore successfully seeded with sample trips!", "success");
  } catch (error) {
    console.error("Error seeding Firestore:", error);
    showNotification("Failed to seed database. Check console.", "error");
  }
}

function deleteUser(userId){
  if(confirm('Are you sure you want to delete this user?')) {
    users = users.filter(u => u.id !== userId);
    localStorage.setItem('users', JSON.stringify(users));
    loadUsers();
    alert('User deleted successfully!');
  }
}

function viewOperatorBuses(operator){
  // Filter buses by operator and show them
  let operatorBuses = buses.filter(b => b.operator === operator);
  alert(`${operator} has ${operatorBuses.length} buses:\n${operatorBuses.map(b => b.name).join('\n')}`);
}

function editRoute(routeKey){
  let [from, to] = routeKey.split('-');
  let newPrice = prompt('Enter new price for this route:');
  if(newPrice) {
    trips.forEach(trip => {
      if(trip.from === from && trip.to === to) {
        trip.price = parseInt(newPrice);
      }
    });
    localStorage.setItem('trips', JSON.stringify(trips));
    loadRoutes();
    alert('Route updated successfully!');
  }
}

async function cancelBooking(ticketId){
    if(confirm('Are you sure you want to delete this booking record?')) {
        try {
            await db.collection('tickets').doc(ticketId.toString()).delete();
            showNotification("Booking deleted successfully", "success");
        } catch (error) {
            alert("Error deleting booking: " + error.message);
        }
    }
}

/* TICKET SCANNER */
function verifyTicket(scannedText) {
  let id = scannedText ? parseInt(scannedText.replace('TICKET:', '')) : parseInt(document.getElementById('scanInput').value);
  let resultDiv = document.getElementById('scanResult');
  resultDiv.classList.remove('hidden');

  // Search for ticket by ID property rather than index
  let ticket = tickets.find(t => t.id == id);

  if (!ticket) {
    resultDiv.style.background = "#fff5f5";
    resultDiv.style.color = "#c53030";
    resultDiv.innerHTML = `<h4><i class="fas fa-times-circle"></i> Invalid Ticket</h4><p>No ticket found with ID #${id}</p>`;
  } else if (ticket.status === "BOARDED" || ticket.status === "USED") {
    resultDiv.style.background = "#fffaf0";
    resultDiv.style.color = "#9b2c2c";
    resultDiv.innerHTML = `<h4><i class="fas fa-exclamation-triangle"></i> Invalid State</h4><p>Ticket #${id} is already ${ticket.status}.</p>`;
  } else if (ticket.status !== "ACTIVE") {
    resultDiv.style.background = "#fff5f5";
    resultDiv.style.color = "#c53030";
    resultDiv.innerHTML = `<h4><i class="fas fa-clock"></i> Not Active</h4><p>Ticket status is ${ticket.status}. Needs Admin activation.</p>`;
  } else {
    resultDiv.style.background = "#f0fff4";
    resultDiv.style.color = "#2f855a";
    resultDiv.innerHTML = `
        <h4><i class="fas fa-check-circle"></i> Ticket Verified!</h4>
        <p>Passenger: ${ticket.passenger} | Seat: <span id="opCurrentSeat">#${ticket.seat || 'N/A'}</span></p>
        <div id="opSeatMapContainer" class="hidden" style="margin-top: 15px; border-top: 1px dashed #2f855a; padding-top: 10px;">
            <p style="font-size: 0.8rem; margin-bottom: 5px; font-weight: bold;">Manual Seat Assignment:</p>
            <div id="opSeatMap" class="seats" style="grid-template-columns: repeat(2, 1fr) 20px repeat(2, 1fr); gap: 5px; margin: 0;"></div>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 15px;">
            <button class="btn" style="flex: 1; background: #2b6cb0;" onclick="toggleOpSeatMap(${ticket.id})">
                <i class="fas fa-chair"></i> ${ticket.seat ? 'Change Seat' : 'Assign Seat'}
            </button>
            <button class="btn" style="flex: 1;" onclick="confirmBoarding(${ticket.id})">
                <i class="fas fa-user-check"></i> Boarding
            </button>
        </div>
    `;
  }
}

function toggleOpSeatMap(ticketId) {
    const container = document.getElementById('opSeatMapContainer');
    const mapDiv = document.getElementById('opSeatMap');
    if (!container.classList.contains('hidden')) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    mapDiv.innerHTML = "";
    const ticket = tickets.find(t => t.id == ticketId);
    const totalBusSeats = 28;
    const occupiedSeats = tickets
        .filter(t => t.bus === ticket.bus && t.date === ticket.date && t.id !== ticketId && t.status !== 'CANCELLED')
        .map(t => t.seat);
    for(let i=1; i<=totalBusSeats; i++) {
        let s = document.createElement("div");
        s.className = "seat";
        s.style.padding = "8px";
        s.style.fontSize = "0.75rem";
        if(occupiedSeats.includes(i)) s.classList.add("booked");
        if(ticket.seat == i) s.classList.add("active");
        s.innerText = i;
        s.onclick = (e) => {
            e.stopPropagation();
            if(s.classList.contains("booked")) return;
            
            db.collection('tickets').doc(ticketId.toString()).update({
                seat: i,
                updatedAt: new Date().toISOString()
            }).then(() => {
                showNotification("Seat updated to #" + i, "success");
                addActivityLog(`Seat for Ticket #${ticketId} changed to #${i} by Operator.`);
            });
        };
        mapDiv.appendChild(s);
        
        // Add aisle spacer
        if (i % 2 === 0 && i % 4 !== 0) {
            mapDiv.appendChild(document.createElement("div"));
        }
    }
}

function confirmBoarding(id) {
    db.collection('tickets').doc(id.toString()).update({
        status: "BOARDED",
        boardedAt: new Date().toISOString()
    }).then(() => {
        showNotification("Boarding Confirmed!", "success");
        document.getElementById('scanResult').classList.add('hidden');
        addActivityLog(`Ticket #${id} marked as BOARDED.`);
    });
}

/**
 * Quickly adds 4 standard daily slots for a terminal and bus in one click.
 */
async function bulkAddSchedules() {
    const busId = document.getElementById('selectBusBulk').value;
    const city = document.getElementById('bulkCity').value.trim();
    const customTimesInput = document.getElementById('bulkCustomTimes').value.trim();

    if(maintenanceMode) {
        showNotification("Bulk generation disabled during Maintenance.", "error");
        return;
    }

    if (!busId || !city) {
        showNotification("Please fill all fields for bulk generation.", "error");
        return;
    }

    const bus = buses.find(b => b.id == busId);
    if (!bus) return;

    const routeParts = bus.route.split(' - ').map(s => s.trim());
    const to = routeParts.find(c => c.toLowerCase() !== city.toLowerCase()) || "Destination";

    let timesToGenerate = ["08:00 AM", "11:00 AM", "02:00 PM", "06:00 PM"];
    
    // If custom times are provided, parse them
    if (customTimesInput) {
        const custom = customTimesInput.split(',').map(t => t.trim()).filter(t => t);
        if (custom.length > 0) {
            timesToGenerate = custom;
        }
    }

    const batch = db.batch();
    timesToGenerate.forEach(time => {
        const tripRef = db.collection('trips').doc();
        batch.set(tripRef, {
            busId, 
            busName: bus.name, 
            from: city, 
            to: to,
            date: 'DAILY', 
            time, 
            price: bus.price, 
            busType: bus.type, 
            amenities: [], 
            totalSeats: 28,
            availableSeats: 28,
            timestamp: new Date().toISOString()
        });
    });

    try {
        await batch.commit();
        showNotification(`Created 4 daily recurring slots for ${bus.name}`, "success");
        addActivityLog(`Admin generated bulk slots for ${bus.name} (${city} to ${to})`);
        document.getElementById('bulkCity').value = "";
    } catch (e) {
        console.error("Bulk Scheduling Error:", e);
        showNotification("Failed to generate bulk slots.", "error");
    }
}