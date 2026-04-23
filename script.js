let role="";
let selectedSeat=null;
let selectedBus=null;
let selectedPayment=null;
let currentUser=null;
let tickets=JSON.parse(localStorage.getItem("tickets")||"[]");
let buses=JSON.parse(localStorage.getItem("buses")||"[]");
let trips=JSON.parse(localStorage.getItem("trips")||"[]");
let users=JSON.parse(localStorage.getItem("users")||"[]");
let notifications=JSON.parse(localStorage.getItem("notifications")||"[]");

/* LOGIN */
function login(){
  let e=email.value,p=password.value;

  if(p!=="1234") return alert("Wrong");

  if(e==="user@bus.ug") role="user";
  else if(e==="bus@bus.ug") role="bus";
  else if(e==="admin@bus.ug") role="admin";
  else return alert("Invalid");

  // Set current user for personalized features
  currentUser = users.find(u => u.email === e) || {name: e.split('@')[0], email: e};

  loginPage.style.display="none";
  app.style.display="block";

  init();
}

function quickFill(type){
  if(type==='admin'){ email.value='admin@bus.ug'; password.value='1234'; }
  else if(type==='user'){ email.value='user@bus.ug'; password.value='1234'; }
  else if(type==='bus'){ email.value='bus@bus.ug'; password.value='1234'; }
}

/* INIT */
function init(){
  // Set default date to today
  let today = new Date().toISOString().split('T')[0];
  document.getElementById('date').value = today;
  document.getElementById('tripDate').value = today;

  userUI.classList.add("hidden");
  busUI.classList.add("hidden");
  adminUI.classList.add("hidden");

  bottomNav.classList.add("hidden");
  sidebar.classList.add("hidden");
  document.getElementById('topbarNav').classList.remove('hidden');
  document.querySelector('.topbar').classList.add('hidden');

  // Back to Top functionality
  window.onscroll = function() {
    let btn = document.getElementById("backToTop");
    if (document.body.scrollTop > 300 || document.documentElement.scrollTop > 300) btn.classList.remove("hidden");
    else btn.classList.add("hidden");
  };

  if(role==="user"){
    userUI.classList.remove("hidden");
    bottomNav.classList.remove("hidden");
    document.getElementById('topbarActions').classList.add('hidden');
    renderBottomNav();
    userTab("home");
    showNotification("Welcome to UG Bus! Book your next trip with ease.", "success");
  }

  if(role==="bus"){
    busUI.classList.remove("hidden");
    bottomNav.classList.remove("hidden");
    document.getElementById('topbarActions').classList.add('hidden');
    renderBottomNav();
    busTab("home");
  }

  if(role==="admin"){
    sidebar.classList.remove("hidden");
    document.getElementById('sidebarToggle').classList.remove("hidden");
    adminUI.classList.remove("hidden");
    document.querySelector('.topbar').classList.remove('hidden');
    document.getElementById('topbarActions').classList.remove('hidden');
    document.getElementById('adminClock').classList.remove('hidden');
    bottomNav.classList.add("hidden");
    startClock();
    adminTab('dashboard'); // Initialize with dashboard
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

function renderBottomNav(){
  let nav = document.getElementById('bottomNav');
  nav.innerHTML = '';

  if(role === 'user'){
    nav.innerHTML = `
      <button onclick="userTab('home')" id="u1"><i class="fas fa-home"></i> Home</button>
      <button onclick="userTab('tickets')" id="u2"><i class="fas fa-ticket-alt"></i> Tickets</button>
      <button onclick="userTab('profile')" id="u3"><i class="fas fa-user"></i> Profile</button>
    `;
  }

  if(role === 'bus'){
    nav.innerHTML = `
      <button onclick="busTab('home')" id="b1"><i class="fas fa-plus"></i> Home</button>
      <button onclick="busTab('fleet')" id="b2"><i class="fas fa-bus"></i> Fleet</button>
      <button onclick="busTab('schedules')" id="b3"><i class="fas fa-calendar"></i> Schedules</button>
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
  userHome.classList.add("hidden");
  userTickets.classList.add("hidden");
  userProfile.classList.add("hidden");

  document.getElementById("u1").classList.remove("active-tab");
  document.getElementById("u2").classList.remove("active-tab");
  document.getElementById("u3").classList.remove("active-tab");

  if(tab==="home"){
    userHome.classList.remove("hidden");
    u1.classList.add("active-tab");
  }else if(tab==="tickets"){
    userTickets.classList.remove("hidden");
    u2.classList.add("active-tab");
    renderTickets();
  }else if(tab==="profile"){
    userProfile.classList.remove("hidden");
    u3.classList.add("active-tab");
    loadProfile();
  }
}

/* BUS NAV */
function busTab(tab){
  busHome.classList.add("hidden");
  busFleet.classList.add("hidden");
  busSchedules.classList.add("hidden");
  busProfile.classList.add("hidden");

  document.getElementById("b1").classList.remove("active-tab");
  document.getElementById("b2").classList.remove("active-tab");
  document.getElementById("b3").classList.remove("active-tab");
  document.getElementById("b4").classList.remove("active-tab");

  if(tab==="home"){
    busHome.classList.remove("hidden");
    b1.classList.add("active-tab");
    loadBusSelect();
  }else if(tab==="fleet"){
    busFleet.classList.remove("hidden");
    b2.classList.add("active-tab");
    renderFleet();
  }else if(tab==="schedules"){
    busSchedules.classList.remove("hidden");
    b3.classList.add("active-tab");
    renderSchedules();
  }else if(tab==="profile"){
    busProfile.classList.remove("hidden");
    b4.classList.add("active-tab");
    loadBusProfile();
  }
}

/* TRIPS */
function loadTrips(){
  let from = document.getElementById('from').value;
  let to = document.getElementById('to').value;
  let date = document.getElementById('date').value;
  let time = document.getElementById('time').value;
  let sortOrder = document.getElementById('sortTrips').value;

  let searchWifi = document.getElementById('searchWifi').checked;
  let searchAc = document.getElementById('searchAc').checked;
  let searchUsb = document.getElementById('searchUsb').checked;
  if(!from || !to || !date) {
    alert("Please fill in all search fields");
    return;
  }

  document.getElementById('trips').innerHTML = "";

  // Filter trips based on search
  let availableTrips = trips.filter(t => 
    t.from.toLowerCase().includes(from.toLowerCase()) && 
    t.to.toLowerCase().includes(to.toLowerCase()) &&
    t.date === date
  ).filter(trip => {
    // Filter by amenities
    if (searchWifi && (!trip.amenities || !trip.amenities.includes('wifi'))) return false;
    if (searchAc && (!trip.amenities || !trip.amenities.includes('snowflake'))) return false;
    if (searchUsb && (!trip.amenities || !trip.amenities.includes('charging-station'))) return false;
    return true;
  });

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
        <button class='btn' onclick='selectSeat("${b.name}", ${b.price})'><i class="fas fa-chair"></i> Select Seat</button>
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
        <button class='btn' onclick='selectSeat("${t.busName}", ${t.price})'><i class="fas fa-chair"></i> Select Seat</button>
      `;
      tripsContainer.appendChild(d);
    });
  }
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
    };
    seats.appendChild(s);
  }
}

/* CONFIRM BOOKING */
function confirmBooking(){
  if(!selectedPayment) {
    alert("Please select a payment method");
    return;
  }

  let ticket = {
    bus: selectedBus.name,
    seat: selectedSeat,
    price: selectedBus.price,
    date: document.getElementById('date').value,
    from: document.getElementById('from').value,
    to: document.getElementById('to').value,
    payment: selectedPayment,
    timestamp: new Date().toISOString()
  };

  tickets.push(ticket);
  localStorage.setItem("tickets", JSON.stringify(tickets));

  addActivityLog(`New booking: ${ticket.from} to ${ticket.to} by ${currentUser.name}`);
  bookingConfirm.classList.add("hidden");
  showNotification("Booking confirmed! Check your tickets.", "success");
  userTab("tickets");
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
    ticketsDiv.innerHTML = "<p>No tickets yet. Book your first trip!</p>";
    return;
  }

  tickets.forEach((t, index)=>{
    let isPast = new Date(t.date) < new Date();
    let d=document.createElement("div");
    d.className="card";
    d.innerHTML=`
      <div style="display: flex; justify-content: space-between;">
        <h4><i class="fas fa-ticket-alt"></i> Ticket #${index+1}</h4>
        <span class="badge ${isPast ? 'bg-secondary' : 'bg-primary'}">${isPast ? 'Past' : 'Active'}</span>
      </div>
      <p><strong>Bus:</strong> ${t.bus || t}</p>
      <p><strong>Seat:</strong> ${t.seat || 'N/A'}</p>
      <p><strong>Route:</strong> ${t.from || 'N/A'} - ${t.to || 'N/A'}</p>
      <p><strong>Date:</strong> ${t.date || 'N/A'}</p>
      <p><strong>Price:</strong> <span class="ugx-price">UGX ${(t.price || 0).toLocaleString()}</span></p>
      <div class="qr-code" title="Scan to verify ticket">
        <i class="fas fa-qrcode"></i>
      </div>
      <div style="display: flex; gap: 10px;">
        <button class="btn" style="flex: 1;" onclick="downloadTicket(${index})"><i class="fas fa-download"></i> Download</button>
        ${(isPast || t.used) ? `<button class="btn" style="flex: 1; background: var(--uganda-yellow); color: #000;" onclick="rebook('${t.from}', '${t.to}')"><i class="fas fa-redo"></i> Rebook</button>` : ''}
      </div>
    `;
    ticketsDiv.appendChild(d);
  });
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
function showRegister(){
  loginPage.classList.add("hidden");
  registerPage.classList.remove("hidden");
}

/* SHOW LOGIN */
function showLogin(){
  registerPage.classList.add("hidden");
  loginPage.classList.remove("hidden");
}

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
  let icon = document.querySelector('.dark-mode-toggle i');
  if(document.body.classList.contains('dark-mode')) {
    icon.className = 'fas fa-sun';
  } else {
    icon.className = 'fas fa-moon';
  }
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
  location.reload();
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
    'activity': 'Activity Log'
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

function loadBookings(){
  let bookingList = document.getElementById('bookingList');
  bookingList.innerHTML = '';
  
  tickets.forEach(ticket => {
    let bookingCard = document.createElement('div');
    bookingCard.className = 'card';
    bookingCard.innerHTML = `
      <h4>Ticket #${ticket.id}</h4>
      <p><i class="fas fa-user"></i> ${ticket.passenger}</p>
      <p><i class="fas fa-route"></i> ${ticket.from} → ${ticket.to}</p>
      <p><i class="fas fa-calendar"></i> ${ticket.date} ${ticket.time}</p>
      <p><i class="fas fa-dollar-sign"></i> UGX ${ticket.price.toLocaleString()}</p>
      <p><i class="fas fa-couch"></i> Seat ${ticket.seat}</p>
      <button class="btn" onclick="cancelBooking(${ticket.id})"><i class="fas fa-times"></i> Cancel</button>
    `;
    bookingList.appendChild(bookingCard);
  });
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
    timestamp: new Date().toISOString()
  };
  
  notifications.push(notification);
  localStorage.setItem('notifications', JSON.stringify(notifications));
  
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
function verifyTicket() {
  let id = parseInt(document.getElementById('scanInput').value);
  let resultDiv = document.getElementById('scanResult');
  resultDiv.classList.remove('hidden');

  let ticketIndex = id - 1;
  let ticket = tickets[ticketIndex];

  if (!ticket) {
    resultDiv.style.background = "#fff5f5";
    resultDiv.style.color = "#c53030";
    resultDiv.innerHTML = `<h4><i class="fas fa-times-circle"></i> Invalid Ticket</h4><p>No ticket found with ID #${id}</p>`;
  } else if (ticket.used) {
    resultDiv.style.background = "#fffaf0";
    resultDiv.style.color = "#9b2c2c";
    resultDiv.innerHTML = `<h4><i class="fas fa-exclamation-triangle"></i> Already Used</h4><p>Ticket #${id} was scanned on ${new Date(ticket.usedAt).toLocaleString()}</p>`;
  } else {
    ticket.used = true;
    ticket.usedAt = new Date().toISOString();
    localStorage.setItem("tickets", JSON.stringify(tickets));
    
    resultDiv.style.background = "#f0fff4";
    resultDiv.style.color = "#2f855a";
    resultDiv.innerHTML = `<h4><i class="fas fa-check-circle"></i> Ticket Verified!</h4><p>Ticket #${id} for ${ticket.from} → ${ticket.to} is valid. Boarding allowed.</p>`;
    addActivityLog(`Ticket #${id} scanned and verified.`);
  }
}