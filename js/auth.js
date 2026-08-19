'use strict';

/* ------------------------------------------------------------------ *
 *  Zugangsverwaltung: Kunden-Registrierung/Login + Admin-Passwort     *
 *  Läuft komplett im Browser (localStorage) -- kein Server, keine     *
 *  echte Sicherheitsgarantie. Passwörter werden gesalzen gehasht      *
 *  (SHA-256), aber ein technisch versierter Nutzer kann den           *
 *  Browser-Speicher einsehen. Für eine kleine, vertrauensbasierte     *
 *  Einkaufsgemeinschaft gedacht, nicht für sensible Daten.            *
 * ------------------------------------------------------------------ */

const AUTH_KEYS = {
  users: 'ws_users',
  admin: 'ws_admin',
  session: 'ws_session'
};

function authLoadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) { return fallback; }
}
function authSaveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* Speicher nicht verfügbar */ }
}

function randomHex(bytes) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  return sha256Hex(salt + ':' + password);
}

/* ---------------------- Kundenkonten ---------------------- */

function getUsers() { return authLoadJSON(AUTH_KEYS.users, []); }
function saveUsers(users) { authSaveJSON(AUTH_KEYS.users, users); }

function findUser(usernameOrEmail) {
  const q = usernameOrEmail.trim().toLowerCase();
  return getUsers().find(u => u.username.toLowerCase() === q || u.email.toLowerCase() === q);
}

async function registerUser(username, email, password, passwordRepeat) {
  username = (username || '').trim();
  email = (email || '').trim();
  if (username.length < 3) throw new Error('Benutzername muss mindestens 3 Zeichen haben.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Bitte eine gültige E-Mail-Adresse angeben.');
  if (password.length < 6) throw new Error('Passwort muss mindestens 6 Zeichen haben.');
  if (password !== passwordRepeat) throw new Error('Die Passwörter stimmen nicht überein.');
  if (findUser(username) || findUser(email)) throw new Error('Benutzername oder E-Mail wird bereits verwendet.');

  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  const users = getUsers();
  users.push({ username, email, salt, hash, createdAt: Date.now() });
  saveUsers(users);
  setSession({ type: 'customer', username });
  return { username, email };
}

async function loginUser(usernameOrEmail, password) {
  const user = findUser(usernameOrEmail || '');
  if (!user) throw new Error('Unbekannter Benutzername oder E-Mail.');
  const hash = await hashPassword(password, user.salt);
  if (hash !== user.hash) throw new Error('Falsches Passwort.');
  setSession({ type: 'customer', username: user.username });
  return user;
}

// Selbstbedienungs-Passwort-Reset: da Konten nur lokal im Browser des Mitglieds liegen (keine
// zentrale Datenbank), kann niemand -- auch nicht die Verwaltung -- ein fremdes Passwort
// zurücksetzen. Stattdessen bestätigt sich das Mitglied selbst über Benutzername + die bei der
// Registrierung hinterlegte E-Mail-Adresse und vergibt direkt ein neues Passwort.
async function resetPassword(username, email, newPassword, newPasswordRepeat) {
  username = (username || '').trim();
  email = (email || '').trim();
  if (newPassword.length < 6) throw new Error('Passwort muss mindestens 6 Zeichen haben.');
  if (newPassword !== newPasswordRepeat) throw new Error('Die Passwörter stimmen nicht überein.');

  const users = getUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || user.email.toLowerCase() !== email.toLowerCase()) {
    throw new Error('Benutzername und E-Mail-Adresse passen nicht zu einem bekannten Konto auf diesem Gerät.');
  }

  user.salt = randomHex(16);
  user.hash = await hashPassword(newPassword, user.salt);
  saveUsers(users);
  setSession({ type: 'customer', username: user.username });
  return user;
}

function exportUsersCSV() {
  const users = getUsers();
  return objectsToCSV(
    users.map(u => ({ Benutzername: u.username, EMail: u.email, Salt: u.salt, Hash: u.hash, Erstellt: new Date(u.createdAt).toISOString() })),
    ['Benutzername', 'EMail', 'Salt', 'Hash', 'Erstellt']
  );
}

function importUsersCSV(text) {
  const rows = parseCSV(text);
  const objs = rowsToObjects(rows);
  const users = objs.map(o => ({
    username: o.Benutzername || o.username,
    email: o.EMail || o.email,
    salt: o.Salt || o.salt,
    hash: o.Hash || o.hash,
    createdAt: o.Erstellt ? Date.parse(o.Erstellt) || Date.now() : Date.now()
  })).filter(u => u.username && u.email && u.salt && u.hash);
  if (!users.length) throw new Error('CSV enthält keine gültigen Konten (Spalten: Benutzername, EMail, Salt, Hash).');
  saveUsers(users);
  return users.length;
}

/* ---------------------- Admin-Passwort ---------------------- */

function hasAdminPassword() { return !!authLoadJSON(AUTH_KEYS.admin, null); }

async function setupAdminPassword(password) {
  if (password.length < 6) throw new Error('Admin-Passwort muss mindestens 6 Zeichen haben.');
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  authSaveJSON(AUTH_KEYS.admin, { salt, hash });
  sessionStorage.setItem('ws_admin_unlocked', '1');
}

async function verifyAdminPassword(password) {
  const rec = authLoadJSON(AUTH_KEYS.admin, null);
  if (!rec) throw new Error('Es ist noch kein Admin-Passwort eingerichtet.');
  const hash = await hashPassword(password, rec.salt);
  if (hash !== rec.hash) throw new Error('Falsches Admin-Passwort.');
  sessionStorage.setItem('ws_admin_unlocked', '1');
}

async function changeAdminPassword(oldPassword, newPassword) {
  await verifyAdminPassword(oldPassword);
  if (newPassword.length < 6) throw new Error('Neues Passwort muss mindestens 6 Zeichen haben.');
  const salt = randomHex(16);
  const hash = await hashPassword(newPassword, salt);
  authSaveJSON(AUTH_KEYS.admin, { salt, hash });
}

function isAdminUnlocked() { return sessionStorage.getItem('ws_admin_unlocked') === '1'; }
function lockAdmin() { sessionStorage.removeItem('ws_admin_unlocked'); }

/* ---------------------- Session ---------------------- */

function setSession(s) { authSaveJSON(AUTH_KEYS.session, s); }
function getSession() { return authLoadJSON(AUTH_KEYS.session, null); }
function clearSession() { localStorage.removeItem(AUTH_KEYS.session); lockAdmin(); }
function isLoggedIn() { return !!getSession(); }
