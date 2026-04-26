let role = null; // Initialize role to null for guest
let selectedSeat = null;
let selectedBus = null;
let selectedPayment = null;
let currentUser = null;
let tickets = JSON.parse(localStorage.getItem("tickets") || "[]");
let buses = JSON.parse(localStorage.getItem("buses") || "[]");
let trips = JSON.parse(localStorage.getItem("trips") || "[]");
let users = JSON.parse(localStorage.getItem("users") || "[]");
let notifications = JSON.parse(localStorage.getItem("notifications") || "[]");
let refunds = JSON.parse(localStorage.getItem("refunds") || "[]");
let html5QrCode = null;

// Development constants
const TEST_USER_EMAIL = "user@smartseat.ug";
const TEST_USER_NAME = "John Doe";

// Seed sample data for development if localStorage is empty
if (users.length === 0) {
  users = [
    { id: 1, name: TEST_USER_NAME, email: TEST_USER_EMAIL, phone: "+256 700 111 222", password: "1234", role: "user", photo: "https://i.pravatar.cc/150?u=john" },
    { id: 2, name: "Sarah Namuli", email: "sarah@smartseat.ug", phone: "+256 700 333 444", password: "1234", role: "user", photo: "https://i.pravatar.cc/150?u=sarah" },
    { id: 3, name: "Admin User", email: "admin@smartseat.ug", phone: "+256 700 999 999", password: "1234", role: "admin", photo: "https://i.pravatar.cc/150?u=admin" }
  ];
  localStorage.setItem("users", JSON.stringify(users));
}

if (tickets.length === 0) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  
  const dayAfter = new Date();
  dayAfter.setDate(dayAfter.getDate() + 2);
  const dayAfterStr = dayAfter.toISOString().split('T')[0];

  tickets = [
    {
      id: 102938,
      bus: "Swift Express",
      seat: 5,
      price: 25000,
      date: tomorrowStr,
      time: "08:00 AM",
      from: "Kampala",
      to: "Jinja",
      payment: "mtn",
      passenger: TEST_USER_NAME,
      email: TEST_USER_EMAIL,
      status: "PAID",
      notify: true,
      timestamp: new Date().toISOString()
    },
    {
      id: 495821,
      bus: "Link Coaches",
      seat: 12,
      price: 30000,
      date: tomorrowStr,
      time: "10:30 AM",
      from: "Kampala",
      to: "Mbarara",
      payment: "airtel",
      passenger: TEST_USER_NAME,
      email: TEST_USER_EMAIL,
      status: "ACTIVE",
      notify: false,
      timestamp: new Date().toISOString()
    },
    {
      id: 882734,
      bus: "Global Coaches",
      seat: 22,
      price: 25000,
      date: dayAfterStr,
      time: "02:00 PM",
      from: "Kampala",
      to: "Masaka",
      payment: "card",
      passenger: TEST_USER_NAME,
      email: TEST_USER_EMAIL,
      status: "PAID",
      notify: true,
      timestamp: new Date().toISOString()
    }
  ];
  localStorage.setItem("tickets", JSON.stringify(tickets));
}

if (notifications.length === 0) {
  notifications = [{ id: 1, title: "Welcome to SmartSeat!", message: "Enjoy your journey with Uganda's premium bus platform.", timestamp: new Date().toISOString(), read: false }];
  localStorage.setItem("notifications", JSON.stringify(notifications));
}

const ugandaCitiesList = ["Kampala", "Jinja", "Entebbe", "Mbarara", "Gulu", "Lira", "Mbale", "Masaka", "Fort Portal", "Arua", "Soroti", "Kabale", "Hoima", "Tororo"];
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
  setTimeout(() => {
    document.getElementById('splashScreen').style.opacity = '0';
    setTimeout(() => document.getElementById('splashScreen').classList.add('hidden'), 500);
    
    if (!localStorage.getItem("onboarded")) {
      document.getElementById('onboardingModal').classList.remove('hidden');
    }
  }, 2000);
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
  const wrapper = document.getElementById('recentSearches');
  
  if (searches.length === 0) {
    wrapper.classList.add('hidden');
    return;
  }
  
  wrapper.classList.remove('hidden');
  container.innerHTML = searches.map(s => `
    <div class="search-chip" onclick="reRunSearch('${s.from}', '${s.to}')">
      <i class="fas fa-history"></i> ${s.from} → ${s.to}
    </div>
  `).join('');
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
    (t.email?.toLowerCase() === currentUser.email?.toLowerCase() || 
     t.passenger === currentUser.name) && 
    ["PAID", "ACTIVE", "VERIFIED", "BOARDED"].includes(t.status)
  ).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 3);

  if (userTickets.length === 0) {
    container.innerHTML = `<p style="text-align:center; color:rgba(255,255,255,0.6); font-size:0.8rem;">No upcoming trips scheduled.</p>`;
    return;
  }

  container.innerHTML = userTickets.map((t, index) => `
    <div class="upcoming-card">
      <div class="up-num">${index + 1}</div>
      <div class="up-center">
        <strong>Bus Terminal 1</strong>
        <p>${t.from} → ${t.to}</p>
        <button class="view-ticket-btn" onclick="expandTicketById(${t.id})">View Ticket</button>
      </div>
      <div class="up-right">
        <div class="up-time-group">
          <div class="up-time">${t.time || '08:00 AM'}</div>
          <div class="up-date">${new Date(t.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</div>
        </div>
        <div class="up-notify-toggle">
          <label class="switch" title="Notify Me">
            <input type="checkbox" ${t.notify ? 'checked' : ''} onchange="toggleJourneyNotify(this, ${t.id})">
            <span class="slider round"></span>
          </label>
        </div>
      </div>
    </div>
  `).join('');
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
        new Notification("SmartSeat Departure Alert", {
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
function login(){
  let e = email.value, p = password.value;

  let foundUser = users.find(u => u.email === e && u.password === p);

  if (foundUser) {
    role = foundUser.role;
    currentUser = foundUser;
  } else if (e === "user@smartseat.ug" && p === "1234") {
    role = "user";
    currentUser = { name: "Guest User", email: e, role: "user" };
  } else if (e === "bus@smartseat.ug" && p === "1234") {
    role = "bus";
    currentUser = { name: "Guest Bus Operator", email: e, role: "bus" };
  } else if (e === "admin@smartseat.ug" && p === "1234") {
    role = "admin";
    currentUser = { name: "Guest Admin", email: e, role: "admin" };
  } else {
    return alert("Invalid email or password");
  }

  // After successful login, hide the login page and re-initialize the app
  document.getElementById('loginPage').classList.add("hidden");
  document.getElementById('loginPage').classList.remove("login"); // Remove login styling
  app.classList.remove("hidden");
  init();
}

function quickFill(type){
  if(type==='admin'){ email.value='admin@smartseat.ug'; password.value='1234'; }
  else if(type==='user'){ email.value='user@smartseat.ug'; password.value='1234'; }
  else if(type==='bus'){ email.value='bus@smartseat.ug'; password.value='1234'; }
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
  // Set default date to today
  const today = new Date().toISOString().split('T')[0];
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
    bottomNav.classList.add("hidden"); // Admin doesn't use bottom nav
    startClock();
    adminTab('dashboard'); // Initialize with dashboard
    showNotification(`Welcome, ${currentUser.name}! Admin panel ready.`, "success");
  }
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
      <button onclick="busTab('analytics')" id="b6"><i class="fas fa-chart-pie"></i> Analytics</button>
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
        fromList.innerHTML = ugandaCitiesList.map(city => `<option value="${city}">`).join('');
    }
    filterToCities();
}

function filterToCities() {
    const fromVal = document.getElementById('from').value;
    const toList = document.getElementById('ugandaCitiesTo');
    if (toList) {
        toList.innerHTML = ugandaCitiesList
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
    dateInput.value = today.toISOString().split('T')[0];
    dateInput.classList.add('hidden');
    document.getElementById('btnOthers').innerText = 'Others';
  } else if (mode === 'tomorrow') {
    document.getElementById('btnTomorrow').classList.add('active');
    today.setDate(today.getDate() + 1);
    dateInput.value = today.toISOString().split('T')[0];
    dateInput.classList.add('hidden');
    document.getElementById('btnOthers').innerText = 'Others';
  } else if (mode === 'others') {
    document.getElementById('btnOthers').classList.add('active');
    dateInput.classList.remove('hidden');
    dateInput.focus();
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
  document.getElementById('busAnalytics').classList.add("hidden");
  document.getElementById('busProfile').classList.add("hidden");

  // Remove active class from all bus nav buttons
  document.querySelectorAll("#bottomNav button").forEach(btn => btn.classList.remove("active-tab"));

  if(tab==="home"){
    document.getElementById('busHome').classList.remove("hidden");
    document.getElementById('b1').classList.add("active-tab");
    loadBusSelect();
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
  }else if(tab==="analytics"){
    document.getElementById('busAnalytics').classList.remove("hidden");
    document.getElementById('b6').classList.add("active-tab");
    loadHeatmap();
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
    alert("Please fill in all search fields");
    return;
  }

  saveRecentSearch(from, to);

  document.getElementById('trips').innerHTML = "";

  // Filter trips based on search
  let availableTrips = trips.filter(t => 
    t.from.toLowerCase().includes(from.toLowerCase()) && 
    t.to.toLowerCase().includes(to.toLowerCase()) &&
    t.date === date
  );

  // Sort trips
  if (sortOrder === "priceLow") availableTrips.sort((a, b) => a.price - b.price);
  else if (sortOrder === "priceHigh") availableTrips.sort((a, b) => b.price - a.price);
  else if (sortOrder === "time") availableTrips.sort((a, b) => a.time.localeCompare(b.time));

  let tripsContainer = document.getElementById('trips');

  if(availableTrips.length === 0) {
    // Show default buses if no scheduled trips
    // Ensure default buses also have amenities for consistent display
    // Note: These are just examples, in a real app, default buses would also come from a data source
    // and have their amenities defined.

    let defaultBuses = [
      {name: "Swift Express", route: `${from} - ${to}`, price: 25000, type: "Standard", time: "08:00", amenities: ['wifi', 'charging-station']},
      {name: "Link Coaches", route: `${from} - ${to}`, price: 30000, type: "Luxury", time: "10:00", amenities: ['wifi', 'snowflake', 'charging-station']},
      {name: "Post Bus", route: `${from} - ${to}`, price: 20000, type: "Standard", time: "14:00", amenities: ['charging-station']}
    ];

    defaultBuses.forEach(b=>{
      let d=document.createElement("div");
      d.className="card";
      d.innerHTML=`
        <h4>${b.name}</h4>
        <p><i class="fas fa-route"></i> ${b.route}</p>
        <p><i class="fas fa-clock"></i> ${b.time} | <i class="fas fa-star"></i> ${b.type}</p>
        <div style="margin: 8px 0; color: var(--text-light);">${(b.amenities || []).map(a => `<i class="fas fa-${a}" style="margin-right: 8px;"></i>`).join('')}</div>
        <p><strong>UGX ${b.price.toLocaleString()}</strong></p>
        <button class='btn' onclick='showBusDetails("${b.name}", ${b.price}, ${JSON.stringify(b.amenities || [])})'><i class="fas fa-info-circle"></i> View Details</button>
      `;
      tripsContainer.appendChild(d);
    });
  } else {
    availableTrips.forEach(t=>{
      let d=document.createElement("div");
      d.className="card";
      d.innerHTML=`
        <h4>${t.busName}</h4>
        <p><i class="fas fa-route"></i> ${t.from} - ${t.to}</p>
        <p><i class="fas fa-clock"></i> ${t.time} | <i class="fas fa-star"></i> ${t.busType}</p>
        <div style="margin: 8px 0; color: var(--text-light);">${(t.amenities || []).map(a => `<i class="fas fa-${a}" style="margin-right: 8px;"></i>`).join('')}</div>
        <p><strong>UGX ${t.price.toLocaleString()}</strong></p>
        <button class='btn' onclick='showBusDetails("${t.busName}", ${t.price}, ${JSON.stringify(t.amenities || [])})'><i class="fas fa-info-circle"></i> View Details</button>
      `;
      tripsContainer.appendChild(d);
    });
  }
}

/* BUS DETAILS SCREEN */
function showBusDetails(name, price, amenities) {
    selectedBus = { name, price, amenities };
    document.getElementById('trips').classList.add('hidden');
    const box = document.getElementById('busDetailsBox');
    box.classList.remove('hidden');
    document.getElementById('detailsBusName').innerText = name;
    document.getElementById('detailsRoute').innerHTML = `
        <i class="fas fa-route"></i> ${document.getElementById('from').value} to ${document.getElementById('to').value}<br>
        <i class="fas fa-tag"></i> Base Fare: UGX ${price.toLocaleString()}
    `;
    document.getElementById('detailsAmenities').innerHTML = amenities.map(a => 
        `<span class="badge bg-primary" style="margin-right:5px;"><i class="fas fa-${a}"></i> ${a}</span>`
    ).join('');
}

function proceedToSeats() {
    document.getElementById('busDetailsBox').classList.add('hidden');
    selectSeat(selectedBus.name, selectedBus.price);
}

/* SEATS */
function selectSeat(busName, price){
  selectedBus = {name: busName, price: price};
  seatBox.classList.remove("hidden");
  seats.innerHTML="";

  // Simulate some booked seats
  let bookedSeats = [3, 7, 12, 15];

  for(let i=1;i<=16;i++){
    let s=document.createElement("div");
    s.className="seat";
    if(bookedSeats.includes(i)) s.classList.add("booked");
    s.innerText=i;
    s.onclick=()=>{
      if(s.classList.contains("booked")) return;
      selectedSeat=i;
      document.querySelectorAll(".seat").forEach(x=>x.classList.remove("active"));
      s.classList.add("active");
      // Real-time price display
      document.getElementById('seatPriceDisplay').style.display = 'block';
      document.getElementById('displaySeatNum').innerText = '#' + i;
      document.getElementById('displaySeatPrice').innerText = 'UGX ' + price.toLocaleString();
    };
    seats.appendChild(s);
  }
}

/* BOOKING FLOW ENHANCEMENTS */
function showBoardingPoints() {
  if (!selectedSeat) return alert("Please select a seat first");
  document.getElementById('seatBox').classList.add("hidden");
  document.getElementById('pointsBox').classList.remove("hidden");
}

function showPassengerInfo() {
  const pCountEl = document.getElementById('passengerCount');
  const count = pCountEl ? (parseInt(pCountEl.value) || 1) : 1;
  const container = document.getElementById('passengerForms');
  container.innerHTML = "";
  for(let i = 1; i <= count; i++) {
    container.innerHTML += `
      <div class="passenger-entry">
        <h5>Passenger ${i}</h5>
        <input placeholder="Full Name" class="p-name">
        <div style="display:flex; gap:10px;">
          <input placeholder="Age" type="number" class="p-age">
          <select class="p-gender"><option>Male</option><option>Female</option></select>
        </div>
      </div>
    `;
  }
  document.getElementById('pointsBox').classList.add("hidden");
  document.getElementById('passengerBox').classList.remove("hidden");
}

function showBookingSummary() {
  const pCountEl = document.getElementById('passengerCount');
  const count = pCountEl ? (parseInt(pCountEl.value) || 1) : 1;
  document.getElementById('passengerBox').classList.add("hidden");
  document.getElementById('bookingConfirm').classList.remove("hidden");
  document.getElementById('bookingDetails').innerHTML = `
    <strong>Bus:</strong> ${selectedBus.name}<br>
    <strong>Route:</strong> ${document.getElementById('from').value} to ${document.getElementById('to').value}<br>
    <strong>Points:</strong> ${document.getElementById('boardingPoint').value} → ${document.getElementById('droppingPoint').value}<br>
    <strong>Total:</strong> UGX ${(selectedBus.price * count).toLocaleString()}
  `;
}

/* CONFIRM BOOKING */
function confirmBooking(){
  if(!selectedPayment) return alert("Select payment method");

  let ticket = {
    bus: selectedBus.name,
    seat: selectedSeat,
    price: selectedBus.price,
    date: document.getElementById('date') ? document.getElementById('date').value : new Date().toISOString().split('T')[0],
    from: document.getElementById('from').value,
    to: document.getElementById('to').value,
    payment: selectedPayment,
    passenger: document.querySelector('.p-name')?.value || currentUser.name,
    email: currentUser.email,
    id: Math.floor(100000 + Math.random() * 900000),
    status: "PAID", // Start at PAID for demo purposes once confirmed
    timestamp: new Date().toISOString()
  };

  tickets.push(ticket);
  localStorage.setItem("tickets", JSON.stringify(tickets));

  addActivityLog(`New booking: ${ticket.from} to ${ticket.to} by ${currentUser.name}`);
  bookingConfirm.classList.add("hidden");
  showNotification("Payment successful! Booking ID: #" + ticket.id, "success");
  showNotification("Booking confirmed! Check your tickets.", "success");
  renderUpcomingJourneys();
  userTab("tickets");
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
UG Bus Premium Ticket
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

function shareTicket(index){
  let t = tickets[index];
  let shareText = `UG Bus Ticket: ${t.from} to ${t.to} on ${t.date}. Bus: ${t.bus}, Seat: ${t.seat}.`;
  
  if (navigator.share) {
    navigator.share({
      title: 'My UG Bus Ticket',
      text: shareText,
      url: window.location.href
    }).catch(console.error);
  } else {
    // Fallback: Copy to clipboard
    navigator.clipboard.writeText(shareText);
    showNotification("Ticket details copied to clipboard!", "success");
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
function loadBusSelect(){
  selectBus.innerHTML = "<option value=''>Select Bus</option>";
  buses.forEach(b => {
    let opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = `${b.name} (${b.route})`;
    selectBus.appendChild(opt);
  });
}

/* ADD BUS */
function addNewBus(){
  let name = document.getElementById('newBusName').value;
  let route = document.getElementById('newBusRoute').value;
  let price = document.getElementById('newBusPrice').value;
  let type = document.getElementById('newBusType').value;

  if(!name || !route || !price) return alert("Please fill all fields");

  let bus = {
    id: Date.now(),
    name, route, type,
    price: parseInt(price),
    operator: currentUser.name
  };

  buses.push(bus);
  localStorage.setItem("buses", JSON.stringify(buses));
  addActivityLog(`New bus registered: ${name} by ${currentUser.name}`);
  
  document.getElementById('newBusName').value = "";
  document.getElementById('newBusRoute').value = "";
  document.getElementById('newBusPrice').value = "";
  renderFleet();
  showNotification("Bus added to fleet!", "success");
}

/* SCHEDULE TRIP */
function scheduleTrip(){
  let busId = selectBus.value;
  let date = tripDate.value;
  let time = departureTime.value;

  let amenities = [];
  if(document.getElementById('wifiAmenity').checked) amenities.push('wifi');
  if(document.getElementById('acAmenity').checked) amenities.push('snowflake');
  if(document.getElementById('usbAmenity').checked) amenities.push('charging-station');

  if(!busId || !date || !time) {
    alert("Please fill all fields");
    return;
  }

  let bus = buses.find(b => b.id == busId);
  if(!bus) return alert("Bus not found");

  let trip = {
    busId, busName: bus.name, from: bus.route.split(' - ')[0], to: bus.route.split(' - ')[1],
    date, time, price: bus.price, busType: bus.type, id: Date.now(), amenities
  };

  trips.push(trip);
  localStorage.setItem("trips", JSON.stringify(trips));

  addActivityLog(`Trip scheduled: ${bus.name} on ${date}`);
  alert("Trip scheduled successfully!");
  tripDate.value = departureTime.value = "";
  document.getElementById('wifiAmenity').checked = false;
  document.getElementById('acAmenity').checked = false;
  document.getElementById('usbAmenity').checked = false;
  renderSchedules();
}

/* RENDER SCHEDULES */
function renderSchedules(){
  schedules.innerHTML="";

  if(trips.length === 0) {
    schedules.innerHTML = "<p>No trips scheduled yet.</p>";
    return;
  }

  trips.forEach(t=>{
    let d=document.createElement("div");
    d.className="card";
    d.innerHTML=`
      <h4>${t.busName}</h4>
      <p><i class="fas fa-route"></i> ${t.from} - ${t.to}</p>
      <p><i class="fas fa-calendar"></i> ${t.date} | <i class="fas fa-clock"></i> ${t.time}</p>
      <p><strong>Seats:</strong> ${t.availableSeats || 16} available out of ${t.totalSeats || 16}</p>
      <div class="seat-preview" style="display: flex; flex-wrap: wrap; gap: 3px; margin-top: 10px;">
        ${generateSeatPreview(t.totalSeats || 16, t.availableSeats || 16)}
      </div>
      <div style="margin: 8px 0; color: var(--text-light);">${(t.amenities || []).map(a => `<i class="fas fa-${a}" style="margin-right: 8px;"></i>`).join('')}</div>
      <p><i class="fas fa-dollar-sign"></i> UGX ${t.price.toLocaleString()}</p>
    `;
    schedules.appendChild(d);
  });
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
  ticketsDiv.innerHTML="";

  if(tickets.length === 0) {
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

  tickets.forEach((t, index) => {
      let statusClass = "bg-secondary";
      let statusLabel = t.status || "PAID";
      if(statusLabel === "ACTIVE") statusClass = "bg-active";
      else if(statusLabel === "BOARDED") statusClass = "bg-boarded";
      else if(statusLabel === "USED") statusClass = "bg-used";
      else if(statusLabel === "PAID") statusClass = "bg-paid";
      
      const isUsed = statusLabel === "USED";

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
            <div style="font-weight:bold; color:var(--primary-color);">SmartSeat Boarding Pass</div>
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
              <div class="info-item"><label>Seat</label><span>#${t.seat}</span></div>
              <div class="info-item"><label>Bus</label><span>${t.bus}</span></div>
              <div class="info-item"><label>Plate</label><span>${t.plate || 'UAX 456Z'}</span></div>
              <div class="info-item"><label>Departure</label><span>${t.date} | ${t.time || '08:00'}</span></div>
              <div class="info-item"><label>Booking ID</label><span>#${t.id}</span></div>
            </div>
            <div class="ticket-qr-section" style="${isUsed ? 'filter: grayscale(1); opacity: 0.5;' : ''}">
              <div class="qr-container"></div>
              <p style="margin:5px 0 0 0; font-size:0.7rem; color:#64748b;">${isUsed ? 'This ticket has already been used' : 'Scan at Boarding'}</p>
            </div>
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
    const element = document.getElementById(`ticket-card-${index}`);
    const canvas = await html2canvas(element);
    const link = document.createElement('a');
    link.download = `SmartSeat-Ticket-${tickets[index].id}.png`;
    link.href = canvas.toDataURL();
    link.click();
}

/* REGISTER */
function register(){
  let name = regName.value;
  let email = regEmail.value;
  let phone = regPhone.value;
  let password = regPassword.value;
  let role = regRole.value;

  if(!name || !email || !phone || !password || !role) {
    alert("Please fill all fields");
    return;
  }

  let user = {name, email, phone, password, role, id: Date.now()};
  users.push(user);
  localStorage.setItem("users", JSON.stringify(users));

  alert("Registration successful! Please login.");
  showLogin();
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
  let user = currentUser || users.find(u => u.email === "user@bus.ug");
  if(user) {
    document.getElementById('userGreeting').innerText = `Hello, ${user.name}!`;
    profileName.value = user.name;
    profileEmail.value = user.email;
    profilePhone.value = user.phone;
  }
}

/* UPDATE PROFILE */
function updateProfile(){
  alert("Profile updated successfully!");
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
function logout(){
  role = null;
  currentUser = null;
  init(); // Re-initialize the app to the guest view
}

/* ADMIN FUNCTIONS */
function adminTab(section){
  // Hide all admin sections
  document.getElementById('adminDashboard').classList.add('hidden');
  document.getElementById('adminUsers').classList.add('hidden');
  document.getElementById('adminOperators').classList.add('hidden');
  document.getElementById('adminRoutes').classList.add('hidden');
  document.getElementById('adminBookings').classList.add('hidden');
  document.getElementById('adminAnalytics').classList.add('hidden');
  document.getElementById('adminPayments').classList.add('hidden');
  document.getElementById('adminNotifications').classList.add('hidden');
  document.getElementById('adminSettings').classList.add('hidden');
  document.getElementById('adminActivity').classList.add('hidden');
  document.getElementById('adminSupportTickets').classList.add('hidden');

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
    'supportTickets': 'Support Tickets'
  };
  title.innerHTML = `<span style="opacity: 0.6; font-weight: 400; font-size: 0.9rem;">Admin</span> <i class="fas fa-chevron-right" style="font-size: 0.7rem; margin: 0 8px; opacity: 0.4;"></i> ${sectionLabels[section] || section}`;

  // Add active class to clicked button
  if (typeof event !== 'undefined' && event && event.target) {
    let target = event.target.closest('button');
    if(target) target.classList.add('active-tab');
  } else {
    let btnId = { 'dashboard': 'a1', 'users': 'a2', 'operators': 'a3', 'routes': 'a4', 'bookings': 'a5', 'analytics': 'a6', 'payments': 'a7', 'notifications': 'a8', 'settings': 'a9', 'activity': 'a10' }[section];
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
}

function loadDashboard(){
  // Update dashboard stats
  document.getElementById('statUsers').textContent = users.length.toLocaleString();
  document.getElementById('statBuses').textContent = buses.length.toLocaleString();
  document.getElementById('statBookings').textContent = tickets.length.toLocaleString();
  document.getElementById('statTrips').textContent = trips.length.toLocaleString();
  
  // Calculate revenue
  let revenue = tickets.reduce((sum, ticket) => sum + (ticket.price || 0), 0);
  document.getElementById('statRevenue').textContent = 'UGX ' + revenue.toLocaleString();
}

function loadUsers(){
  let userList = document.getElementById('userList');
  userList.innerHTML = '';
  
  let query = document.getElementById('userSearch') ? document.getElementById('userSearch').value.toLowerCase() : '';
  
  let filteredUsers = users.filter(user => 
    user.name.toLowerCase().includes(query) || 
    user.email.toLowerCase().includes(query)
  );
  
  filteredUsers.forEach(user => {
    let userCard = document.createElement('div');
    userCard.className = 'card';
    userCard.innerHTML = `
      <h4>${user.name}</h4>
      <p><i class="fas fa-envelope"></i> ${user.email}</p>
      <p><i class="fas fa-phone"></i> ${user.phone}</p>
      <p><i class="fas fa-user-tag"></i> ${user.role}</p>
      <button class="btn" onclick="deleteUser(${user.id})"><i class="fas fa-trash"></i> Delete</button>
    `;
    userList.appendChild(userCard);
  });
}

function loadOperators(){
  let operatorList = document.getElementById('operatorList');
  operatorList.innerHTML = '';
  
  let operators = buses.map(bus => bus.operator).filter((op, index, arr) => arr.indexOf(op) === index);
  
  operators.forEach(operator => {
    let operatorCard = document.createElement('div');
    operatorCard.className = 'card';
    operatorCard.innerHTML = `
      <h4>${operator}</h4>
      <p><i class="fas fa-bus"></i> ${buses.filter(b => b.operator === operator).length} buses</p>
      <button class="btn" onclick="viewOperatorBuses('${operator}')"><i class="fas fa-eye"></i> View Buses</button>
    `;
    operatorList.appendChild(operatorCard);
  });
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
  
  routes.forEach(route => {
    let routeCard = document.createElement('div');
    routeCard.className = 'card';
    routeCard.innerHTML = `
      <h4>${route.from} → ${route.to}</h4>
      <p><i class="fas fa-dollar-sign"></i> UGX ${route.price.toLocaleString()}</p>
      <p><i class="fas fa-ticket-alt"></i> ${route.bookings} bookings</p>
      <button class="btn" onclick="editRoute('${route.key}')"><i class="fas fa-edit"></i> Edit</button>
    `;
    routeList.appendChild(routeCard);
  });
}

function loadSupportTickets() {
    const container = document.getElementById('adminRefundList');
    container.innerHTML = '';
    if (refunds.length === 0) {
        container.innerHTML = '<p>No pending refund requests found.</p>';
        return;
    }
    refunds.forEach(r => {
        const t = tickets.find(ticket => ticket.id == r.ticketId);
        const d = document.createElement('div');
        d.className = 'card';
        d.innerHTML = `
            <h4>Refund Request #${r.id}</h4>
            <p><strong>Ticket ID:</strong> #${r.ticketId}</p>
            <p><strong>Passenger:</strong> ${t ? t.passenger : 'N/A'}</p>
            <p><strong>Reason:</strong> ${r.reason}</p>
            <p><strong>Status:</strong> <span class="badge ${r.status === 'Pending' ? 'bg-primary' : 'bg-secondary'}">${r.status}</span></p>
            ${r.status === 'Pending' ? `
                <div style="display:flex; gap:10px; margin-top:10px;">
                    <button class="btn" style="background:#48bb78;" onclick="updateRefundStatus(${r.id}, 'Approved')">Approve</button>
                    <button class="btn" style="background:#e53e3e;" onclick="updateRefundStatus(${r.id}, 'Rejected')">Reject</button>
                </div>
            ` : ''}
        `;
        container.appendChild(d);
    });
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

function loadBookings(){
  let bookingList = document.getElementById('bookingList');
  bookingList.innerHTML = '';
  
  tickets.forEach(ticket => {
    let status = ticket.status || "PAID";
    let bookingCard = document.createElement('div');
    bookingCard.className = 'card';
    bookingCard.innerHTML = `
      <h4>Ticket #${ticket.id}</h4>
      <p><i class="fas fa-user"></i> ${ticket.passenger}</p>
      <p><i class="fas fa-route"></i> ${ticket.from} → ${ticket.to}</p>
      <p><i class="fas fa-calendar"></i> ${ticket.date} ${ticket.time}</p>
      <p><i class="fas fa-dollar-sign"></i> UGX ${ticket.price.toLocaleString()}</p>
      <p><i class="fas fa-info-circle"></i> Status: <strong>${status}</strong></p>
      <div style="margin-top: 10px; display: flex; gap: 5px; flex-wrap: wrap;">
        ${status === 'PAID' ? `<button class="btn btn-sm" style="background:#48bb78;" onclick="updateTicketStatus(${ticket.id}, 'VERIFIED')">Approve Payment</button>` : ''}
        ${status === 'VERIFIED' ? `
            <select id="opAssign-${ticket.id}" style="width: auto; padding: 5px;">
                <option value="Operator_1">Bus 001 (Main)</option>
                <option value="Operator_2">Bus 002 (Express)</option>
            </select>
            <button class="btn btn-sm" onclick="assignOperator(${ticket.id})">Assign & Activate</button>
        ` : ''}
        ${status === 'BOARDED' ? `<button class="btn btn-sm" style="background:var(--text-light);" onclick="updateTicketStatus(${ticket.id}, 'USED')">Mark as Used</button>` : ''}
        <button class="btn btn-sm" style="background:var(--uganda-red);" onclick="cancelBooking(${ticket.id})">Cancel</button>
      </div>
    `;
    bookingList.appendChild(bookingCard);
  });
}

function updateTicketStatus(id, newStatus) {
    let ticket = tickets.find(t => t.id == id);
    if(ticket) {
        ticket.status = newStatus;
        localStorage.setItem("tickets", JSON.stringify(tickets));
        showNotification(`Ticket #${id} updated to ${newStatus}`, "success");
        loadBookings();
    }
}

function assignOperator(id) {
    const op = document.getElementById(`opAssign-${id}`).value;
    let ticket = tickets.find(t => t.id == id);
    if(ticket) {
        ticket.status = "ACTIVE";
        ticket.assignedOperator = op;
        localStorage.setItem("tickets", JSON.stringify(tickets));
        showNotification(`Ticket assigned to ${op}`, "success");
        loadBookings();
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
  let settings = JSON.parse(localStorage.getItem('appSettings') || '{"appName": "UG Bus Premium", "supportEmail": "support@ugbus.ug", "supportPhone": "+256 414 123 456", "bookingFee": 2}');
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
    date: new Date().toISOString().split('T')[0],
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

function cancelBooking(ticketId){
  if(confirm('Are you sure you want to cancel this booking?')) {
    tickets = tickets.filter(t => t.id !== ticketId);
    localStorage.setItem('tickets', JSON.stringify(tickets));
    loadBookings();
    alert('Booking cancelled successfully!');
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
            <div id="opSeatMap" class="seats" style="grid-template-columns: repeat(4, 1fr); gap: 5px; margin: 0;"></div>
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
    const occupiedSeats = tickets
        .filter(t => t.bus === ticket.bus && t.date === ticket.date && t.id !== ticketId && t.status !== 'CANCELLED')
        .map(t => t.seat);
    for(let i=1; i<=16; i++) {
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
            ticket.seat = i;
            localStorage.setItem("tickets", JSON.stringify(tickets));
            document.getElementById('opCurrentSeat').innerText = '#' + i;
            document.querySelectorAll("#opSeatMap .seat").forEach(x => x.classList.remove("active"));
            s.classList.add("active");
            showNotification("Seat updated to #" + i, "success");
            addActivityLog(`Seat for Ticket #${ticket.id} changed to #${i} by Operator.`);
        };
        mapDiv.appendChild(s);
    }
}

function confirmBoarding(id) {
    let ticket = tickets.find(t => t.id == id);
    if(ticket) {
        ticket.status = "BOARDED";
        ticket.boardedAt = new Date().toISOString();
        localStorage.setItem("tickets", JSON.stringify(tickets));
        showNotification("Boarding Confirmed!", "success");
        document.getElementById('scanResult').classList.add('hidden');
        addActivityLog(`Ticket #${id} marked as BOARDED.`);
    }
}