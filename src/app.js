// src/app.js
// ─────────────────────────────────────────────────────────────
// Portal Meditatii Mate – Main Application
//
// Architecture:
//   • All data is fetched from Supabase (PostgreSQL via REST API)
//   • No localStorage for app data – only the Supabase auth
//     session token lives in localStorage (managed by the SDK)
//   • Admin is a real authenticated user (email + password)
//   • Parents look up students by phone number (no account needed)
//   • All user-supplied strings are HTML-escaped before rendering
// ─────────────────────────────────────────────────────────────

import { supabase }                             from './lib/supabase.js';
import { adminSignIn, adminSignOut, getSession, onAuthChange } from './modules/auth.js';
import { fetchStudents, lookupStudentByPhone, saveStudent, deleteStudent } from './modules/students.js';
import { fetchSlots, fetchSlotsWithStudents, saveSlotsBatch }              from './modules/slots.js';
import { fetchPaymentSettings, savePaymentSettings, createPayment, fetchPayments, updatePaymentStatus } from './modules/payments.js';
import { escapeHtml, escapeAttr, ValidationError }             from './modules/validation.js';

// ── App State ─────────────────────────────────────────────────
// Single source of truth – never mutate directly, use setters.

const state = {
  adminSession: null,    // Supabase session | null
  settings:     null,    // { iban, revolut, btPay, pricePerHour }
  students:     [],      // admin-only list
  slots:        [],      // public slots array
  payments:     [],      // admin-only payments
  activeStudent: null,   // { id, studentName, parentName, phone } – for parent view
  checkout:     null,    // { studentId, studentName, hours, method }
  loading:      {},      // { [key]: true } – tracks in-flight requests
};

// ── DOM References ────────────────────────────────────────────

const els = {
  toast:           document.querySelector('#toast'),
  parentLookup:    document.querySelector('#parent-lookup'),
  phoneInput:      document.querySelector('#phone-input'),
  parentEmpty:     document.querySelector('#parent-empty'),
  parentAccount:   document.querySelector('#parent-account'),
  paymentPage:     document.querySelector('#payment-page'),
  backToPortal:    document.querySelector('#back-to-portal'),
  publicCalendar:  document.querySelector('#public-calendar'),
  adminLoginBox:   document.querySelector('#admin-login'),
  adminLoginForm:  document.querySelector('#admin-login-form'),
  adminEmail:      document.querySelector('#admin-email'),
  adminPassword:   document.querySelector('#admin-password'),
  adminLoginError: document.querySelector('#admin-login-error'),
  adminView:       document.querySelector('#admin-view'),
  adminMetrics:    document.querySelector('#admin-metrics'),
  settingsForm:    document.querySelector('#settings-form'),
  settingsIban:    document.querySelector('#settings-iban'),
  settingsRevolut: document.querySelector('#settings-revolut'),
  settingsBtPay:   document.querySelector('#settings-btpay'),
  settingsPrice:   document.querySelector('#settings-price'),
  studentForm:     document.querySelector('#student-form'),
  studentIdInput:  document.querySelector('#student-id'),
  studentName:     document.querySelector('#student-name'),
  parentName:      document.querySelector('#parent-name'),
  studentPhone:    document.querySelector('#student-phone'),
  studentNotes:    document.querySelector('#student-notes'),
  clearStudent:    document.querySelector('#clear-student'),
  studentList:     document.querySelector('#student-list'),
  adminCalendar:   document.querySelector('#admin-calendar'),
  saveAllSlots:    document.querySelector('#save-all-slots'),
  adminLogout:     document.querySelector('#admin-logout'),
  paymentsPanel:   document.querySelector('#payments-panel'),
  paymentsList:    document.querySelector('#payments-list'),
};

// ── Bootstrap ─────────────────────────────────────────────────

async function init() {
  // Restore admin session on page load
  state.adminSession = await getSession();

  // Listen for auth changes (login/logout in other tabs, token refresh)
  onAuthChange((event, session) => {
    state.adminSession = session;
    if (event === 'SIGNED_OUT') {
      showAdminLogin();
    } else if (event === 'SIGNED_IN') {
      onAdminSignedIn();
    }
  });

  // Wire up navigation
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.view));
  });

  // Wire up forms and buttons
  els.parentLookup.addEventListener('submit', handleParentLookup);
  els.backToPortal.addEventListener('click', () => navigateTo('portal'));
  els.adminLoginForm.addEventListener('submit', handleAdminLogin);
  els.studentForm.addEventListener('submit', handleStudentSave);
  els.settingsForm.addEventListener('submit', handleSettingsSave);
  els.clearStudent.addEventListener('click', clearStudentForm);
  els.saveAllSlots.addEventListener('click', handleSaveAllSlots);
  els.adminLogout.addEventListener('click', handleAdminLogout);

  // Restore hash-based navigation
  const hash = window.location.hash.replace('#', '') || 'portal';
  navigateTo(hash);

  // Load public data (calendar + settings for payment display)
  await Promise.all([
    loadPublicData(),
    state.adminSession ? onAdminSignedIn() : Promise.resolve(),
  ]);
}

// ── Public Data (no auth required) ───────────────────────────

async function loadPublicData() {
  try {
    const [settings, slots] = await Promise.all([
      fetchPaymentSettings(),
      fetchSlots(),
    ]);
    state.settings = settings;
    state.slots    = slots;
    renderPublicCalendar();
  } catch (err) {
    console.error('Failed to load public data:', err);
    showToast('Eroare la incarcarea datelor. Reincarca pagina.');
  }
}

// ── Admin ─────────────────────────────────────────────────────

async function onAdminSignedIn() {
  els.adminLoginBox.classList.add('hidden');
  els.adminView.classList.remove('hidden');
  els.adminLogout.classList.remove('hidden');

  await loadAdminData();
}

async function loadAdminData() {
  setLoading('admin', true);
  try {
    const [students, slotsWithStudents, settings, payments] = await Promise.all([
      fetchStudents(),
      fetchSlotsWithStudents(),
      fetchPaymentSettings(),
      fetchPayments(),
    ]);
    state.students = students;
    state.slots    = slotsWithStudents;
    state.settings = settings;
    state.payments = payments;

    renderAdmin();
    renderPublicCalendar();
  } catch (err) {
    console.error('Admin load error:', err);
    showToast('Eroare la incarcarea datelor admin.');
  } finally {
    setLoading('admin', false);
  }
}

function showAdminLogin() {
  els.adminView.classList.add('hidden');
  els.adminLogout.classList.add('hidden');
  els.adminLoginBox.classList.remove('hidden');
}

async function handleAdminLogin(event) {
  event.preventDefault();
  const email    = els.adminEmail.value.trim();
  const password = els.adminPassword.value;

  if (!email || !password) {
    setLoginError('Introdu email si parola.');
    return;
  }

  setLoginError('');
  setLoading('login', true);
  els.adminLoginForm.querySelector('button[type=submit]').disabled = true;

  try {
    const { session, error } = await adminSignIn(email, password);
    if (error || !session) {
      setLoginError('Email sau parola incorecte.');
    }
    // onAuthChange handles the rest
  } catch {
    setLoginError('Eroare de retea. Incearca din nou.');
  } finally {
    setLoading('login', false);
    els.adminLoginForm.querySelector('button[type=submit]').disabled = false;
    els.adminPassword.value = '';
  }
}

function setLoginError(msg) {
  els.adminLoginError.textContent = msg;
  els.adminLoginError.classList.toggle('hidden', !msg);
}

async function handleAdminLogout() {
  await adminSignOut();
  state.adminSession = null;
  state.students     = [];
  state.payments     = [];
  showToast('Ai iesit din cont.');
}

// ── Students ──────────────────────────────────────────────────

async function handleStudentSave(event) {
  event.preventDefault();
  setLoading('studentSave', true);

  try {
    await saveStudent({
      id:          els.studentIdInput.value || null,
      studentName: els.studentName.value,
      parentName:  els.parentName.value,
      phone:       els.studentPhone.value,
      notes:       els.studentNotes.value,
    });
    clearStudentForm();
    await loadAdminData();
    showToast('Elev salvat.');
  } catch (err) {
    showToast(err instanceof ValidationError ? err.message : 'Eroare la salvare.');
  } finally {
    setLoading('studentSave', false);
  }
}

function fillStudentForm(student) {
  els.studentIdInput.value = student.id;
  els.studentName.value    = student.studentName;
  els.parentName.value     = student.parentName;
  els.studentPhone.value   = student.phone;
  els.studentNotes.value   = student.notes ?? '';
  els.studentName.focus();
  els.studentName.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearStudentForm() {
  els.studentIdInput.value = '';
  els.studentName.value    = '';
  els.parentName.value     = '';
  els.studentPhone.value   = '';
  els.studentNotes.value   = '';
}

async function handleDeleteStudent(id) {
  if (!confirm('Stergi elevul? Datele istorice de plata sunt pastrate.')) return;

  setLoading('studentDelete', true);
  try {
    await deleteStudent(id);
    await loadAdminData();
    showToast('Elev sters.');
  } catch (err) {
    showToast('Eroare la stergere.');
  } finally {
    setLoading('studentDelete', false);
  }
}

// ── Slots ─────────────────────────────────────────────────────

async function handleSaveAllSlots() {
  const updates = [];
  let error = null;

  state.slots.forEach(slot => {
    const statusEl  = els.adminCalendar.querySelector(`[data-slot-status="${slot.id}"]`);
    const studentEl = els.adminCalendar.querySelector(`[data-slot-student="${slot.id}"]`);
    if (!statusEl || !studentEl) return;

    const status    = statusEl.value;
    const studentId = studentEl.value || null;

    if (status === 'booked' && !studentId) {
      error = `Alege un elev pentru ora ${slot.day} ${slot.time}.`;
    }

    updates.push({ id: slot.id, status, studentId });
  });

  if (error) { showToast(error); return; }

  setLoading('slots', true);
  try {
    await saveSlotsBatch(updates);
    await loadAdminData();
    showToast('Toate orele au fost salvate.');
  } catch (err) {
    showToast(err.message || 'Eroare la salvare ore.');
  } finally {
    setLoading('slots', false);
  }
}

// ── Payment Settings ──────────────────────────────────────────

async function handleSettingsSave(event) {
  event.preventDefault();
  setLoading('settings', true);

  try {
    await savePaymentSettings({
      iban:         els.settingsIban.value,
      revolut:      els.settingsRevolut.value,
      btPay:        els.settingsBtPay.value,
      pricePerHour: Number(els.settingsPrice.value) || 50,
    });
    await loadPublicData();
    showToast('Datele de plata au fost actualizate.');
  } catch (err) {
    showToast(err instanceof ValidationError ? err.message : 'Eroare la salvare.');
  } finally {
    setLoading('settings', false);
  }
}

// ── Parent Portal ─────────────────────────────────────────────

async function handleParentLookup(event) {
  event.preventDefault();
  const phone = els.phoneInput.value.trim();
  if (!phone) return;

  setLoading('lookup', true);
  const btn = els.parentLookup.querySelector('button[type=submit]');
  btn.disabled = true;

  try {
    // Returns [] if not found, or 1+ students sharing the same phone
    const students = await lookupStudentByPhone(phone);

    if (!students.length) {
      state.activeStudent = null;
      els.parentAccount.classList.add('hidden');
      els.parentEmpty.classList.remove('hidden');
      els.parentEmpty.innerHTML = `
        <strong>Nu am gasit un cont pentru acest numar.</strong>
        <span>Verifica formatul sau adauga elevul din panoul admin.</span>
      `;
      return;
    }

    // Store first as active (used by payment flow)
    state.activeStudent = students[0];
    els.parentEmpty.classList.add('hidden');
    els.parentAccount.classList.remove('hidden');

    if (students.length === 1) {
      // Single student — render directly
      renderParentAccount(students[0]);
    } else {
      // Multiple students on same phone — show picker first
      renderStudentPicker(students);
    }
  } catch (err) {
    showToast('Eroare la cautare. Incearca din nou.');
  } finally {
    setLoading('lookup', false);
    setTimeout(() => { btn.disabled = false; }, 800);
  }
}

/**
 * When multiple students share a phone number, show a simple
 * card-picker so the parent selects which child they're paying for.
 */
function renderStudentPicker(students) {
  els.parentAccount.innerHTML = `
    <div class="panel" style="padding:18px">
      <p class="eyebrow" style="margin-bottom:12px">Mai multi elevi pe acest numar</p>
      <p class="hint" style="margin-bottom:16px">Alege elevul pentru care vrei sa vezi programul:</p>
      <div class="student-picker">
        ${students.map(s => `
          <button class="picker-card" data-student-id="${escapeAttr(s.id)}" type="button">
            <strong>${escapeHtml(s.studentName)}</strong>
            ${s.parentName ? `<span>${escapeHtml(s.parentName)}</span>` : ''}
          </button>
        `).join('')}
      </div>
    </div>
  `;

  els.parentAccount.querySelectorAll('.picker-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const student = students.find(s => s.id === btn.dataset.studentId);
      if (student) {
        state.activeStudent = student;
        renderParentAccount(student);
      }
    });
  });
}

// ── Payments (parent-facing) ──────────────────────────────────

function openPaymentPage(studentId, studentName, hours) {
  const price = state.settings?.pricePerHour ?? 50;
  state.checkout = { studentId, studentName, hours, method: 'bank', amountLei: hours * price };
  renderPaymentPage();
  navigateTo('payment');
}

async function handleConfirmPayment() {
  const { studentId, hours, amountLei, method } = state.checkout;
  setLoading('payment', true);
  const btn = document.querySelector('#confirm-payment-btn');
  if (btn) btn.disabled = true;

  try {
    await createPayment({ studentId, hours, amountLei, method });
    showToast('Plata inregistrata! Profesorul va confirma in curand.');
    // Show a success state instead of the form
    const confirmBox = document.querySelector('#payment-confirm-box');
    const detailsBox = document.querySelector('#payment-details-box');
    if (confirmBox && detailsBox) {
      detailsBox.classList.add('hidden');
      confirmBox.classList.remove('hidden');
    }
  } catch (err) {
    showToast('Eroare la inregistrarea platii. Incearca din nou.');
    if (btn) btn.disabled = false;
  } finally {
    setLoading('payment', false);
  }
}

// ── Admin: Payments Panel ─────────────────────────────────────

async function handlePaymentStatusChange(id, status) {
  try {
    await updatePaymentStatus(id, status, '');
    await loadAdminData();
    showToast('Status actualizat.');
  } catch {
    showToast('Eroare la actualizare.');
  }
}

// ── Render: Public Calendar (time-grid week view) ────────────

// Layout constants – change HOUR_PX to scale the entire grid
const HOUR_PX   = 64;   // height of one hour row in pixels
const HALF_PX   = HOUR_PX / 2;
const GRID_START = 6;   // first hour shown (6 = 6:00)
const GRID_END   = 23;  // last hour shown  (23 = 23:00)

function renderPublicCalendar() {
  const ALL_DAYS = ['Luni', 'Marti', 'Miercuri', 'Joi', 'Vineri', 'Sambata', 'Duminica'];

  if (!state.slots.length) {
    els.publicCalendar.innerHTML = '<p class="hint">Nu exista ore disponibile momentan.</p>';
    return;
  }

  // Which days actually have at least one slot?
  const activeDays = ALL_DAYS.filter(d => state.slots.some(s => s.day === d));

  els.publicCalendar.innerHTML = buildTimeGrid(activeDays, state.slots, false);
}

/**
 * Build a full time-grid HTML string.
 *
 * @param {string[]} days       - Ordered day labels to show as columns
 * @param {object[]} slots      - Slot objects { day, time, status, studentName? }
 * @param {boolean}  isAdmin    - If true, renders editable selects inside each event
 * @returns {string}            - HTML string for the grid container
 */
function buildTimeGrid(days, slots, isAdmin) {
  const totalHours  = GRID_END - GRID_START;
  const totalHeight = totalHours * HOUR_PX;

  // ── Time gutter (left labels) ─────────────────────────────────
  let timeGutter = '';
  for (let h = GRID_START; h <= GRID_END; h++) {
    const top = (h - GRID_START) * HOUR_PX;
    const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
    timeGutter += `<div class="tg-hour-label" style="top:${top}px">${label}</div>`;
  }

  // ── Column headers ────────────────────────────────────────────
  const dayShort = { Luni:'Lu', Marti:'Ma', Miercuri:'Mi', Joi:'Jo', Vineri:'Vi', Sambata:'Sb', Duminica:'Du' };
  const colHeaders = days.map(d =>
    `<div class="tg-col-header"><span class="tg-day-short">${dayShort[d] ?? d}</span><span class="tg-day-full">${d}</span></div>`
  ).join('');

  // ── Background grid lines (per column) ───────────────────────
  let bgLines = '';
  for (let h = GRID_START; h < GRID_END; h++) {
    const top     = (h - GRID_START) * HOUR_PX;
    const halfTop = top + HALF_PX;
    bgLines += `<div class="tg-line-hour"  style="top:${top}px"></div>`;
    bgLines += `<div class="tg-line-half"  style="top:${halfTop}px"></div>`;
  }
  // Final hour line at the bottom
  bgLines += `<div class="tg-line-hour" style="top:${totalHeight}px"></div>`;

  // ── Student options for admin dropdowns ───────────────────────
  const studentOptions = isAdmin ? [
    '<option value="">Neatribuit</option>',
    ...state.students.map(s => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.studentName)}</option>`),
  ].join('') : '';

  // ── Event blocks per day ──────────────────────────────────────
  const cols = days.map(day => {
    const daySlots = slots
      .filter(s => s.day === day)
      .sort((a, b) => parseTime(a.time) - parseTime(b.time));

    const events = daySlots.map((slot, i) => {
const [startMin, endMin] = parseTimeRange(slot.time);
    const top      = ((startMin - GRID_START * 60) / 60) * HOUR_PX;
      const durationMin = Math.max(endMin - startMin, 30); // minimum 30 min tall
      const height     = (durationMin / 60) * HOUR_PX - 2; // 2px gap between events

      if (isAdmin) {
        // Admin: editable dropdowns inside the event block
        const selectedOpt = studentOptions.replace(
          `value="${escapeAttr(slot.studentId ?? '')}"`,
          `value="${escapeAttr(slot.studentId ?? '')}" selected`
        );
        const isBooked = slot.status === 'booked';
        return `
          <div class="tg-event tg-event--${slot.status}" style="top:${top}px;height:${height}px"
               data-slot-id="${escapeAttr(slot.id)}">
            <div class="tg-event-time">${escapeHtml(slot.time)}</div>
            <div class="tg-event-controls">
              <select class="tg-select" data-slot-status="${escapeAttr(slot.id)}"
                      aria-label="Status ${escapeHtml(slot.day)} ${escapeHtml(slot.time)}">
                <option value="free"   ${!isBooked ? 'selected' : ''}>Liber</option>
                <option value="booked" ${ isBooked ? 'selected' : ''}>Ocupat</option>
              </select>
              <select class="tg-select" data-slot-student="${escapeAttr(slot.id)}"
                      aria-label="Elev ${escapeHtml(slot.day)} ${escapeHtml(slot.time)}">
                ${selectedOpt}
              </select>
            </div>
            ${isBooked && slot.studentName
              ? `<div class="tg-event-name">${escapeHtml(slot.studentName)}</div>`
              : ''}
          </div>`;
      } else {
        // Public: read-only coloured block
        const isBooked = slot.status === 'booked';
        const label    = isBooked ? 'Ocupat' : 'Liber';
        return `
          <div class="tg-event tg-event--${slot.status}" style="top:${top}px;height:${height}px"
               role="img" aria-label="${escapeAttr(slot.day)} ${escapeAttr(slot.time)} – ${label}">
            <div class="tg-event-time">${escapeHtml(slot.time)}</div>
            <div class="tg-event-label">${label}</div>
          </div>`;
      }
    }).join('');

    return `
      <div class="tg-col" style="height:${totalHeight}px">
        ${bgLines}
        ${events}
      </div>`;
  }).join('');

  return `
    <div class="time-grid" role="region" aria-label="Calendar disponibilitate">
      <div class="tg-header">
        <div class="tg-gutter-placeholder"></div>
        ${colHeaders}
      </div>
      <div class="tg-body">
        <div class="tg-gutter">${timeGutter}</div>
        <div class="tg-cols">${cols}</div>
      </div>
    </div>`;
}

// ── Render: Parent Account ────────────────────────────────────

function renderParentAccount(student) {
  const price = state.settings?.pricePerHour ?? 50;
  const studentSlots = state.slots.filter(s => s.studentId === student.id && s.status === 'booked');

  const scheduleHtml = studentSlots.length
    ? studentSlots.map(s => `
        <div class="slot-item">
          <strong>${escapeHtml(s.day)}</strong>
          <span>${escapeHtml(s.time)}</span>
        </div>
      `).join('')
    : '<p class="hint" style="margin:0">Nicio ora alocata momentan.</p>';

  els.parentAccount.innerHTML = `
    <div class="summary-grid">
      <div class="metric">
        <span>Pret</span>
        <strong>${price} lei / ora</strong>
      </div>
      <div class="metric">
        <span>Format</span>
        <strong>Online</strong>
      </div>
      <div class="metric">
        <span>Plata</span>
        <strong>Transfer / Revolut / BT Pay</strong>
      </div>
    </div>

    ${studentSlots.length ? `
      <div class="panel" style="padding:16px">
        <p class="eyebrow" style="margin-bottom:10px">Orele tale fixe</p>
        <div class="slots-grid">${scheduleHtml}</div>
      </div>
    ` : ''}

    <div class="payment-box">
      <div class="row-title">
        <strong>${escapeHtml(student.studentName)}</strong>
        <span>${student.parentName ? `Parinte: ${escapeHtml(student.parentName)} · ` : ''}Alege cate ore vrei sa platesti</span>
      </div>
      <div class="payment-options" id="payment-options">
        ${paymentOptionBtn('1', 1, 'O ora',     price)}
        ${paymentOptionBtn('2', 2, 'Doua ore',  price)}
        <label class="manual-hours" aria-label="Numar manual de ore">
          <span>Manual</span>
          <input id="manual-hours" type="number" min="1" max="20" step="1" value="1"
                 aria-label="Numar de ore de platit" />
        </label>
      </div>
      <div class="form-actions">
        <button id="go-to-payment" type="button">Plateste</button>
      </div>
      <p class="hint">Dupa ce apesi, se deschide pagina cu datele pentru transfer bancar, Revolut sau BT Pay.</p>
    </div>
  `;

  // Wire up payment options
  let selectedHours = 1;
  const manualInput = els.parentAccount.querySelector('#manual-hours');

  els.parentAccount.querySelectorAll('.pay-option').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedHours = Number(btn.dataset.hours);
      els.parentAccount.querySelectorAll('.pay-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      manualInput.value = selectedHours;
    });
  });

  manualInput?.addEventListener('input', () => {
    selectedHours = Number(manualInput.value);
    els.parentAccount.querySelectorAll('.pay-option').forEach(b => b.classList.remove('active'));
  });

  // Select first option by default
  const first = els.parentAccount.querySelector('.pay-option');
  if (first) first.classList.add('active');

  els.parentAccount.querySelector('#go-to-payment').addEventListener('click', () => {
    const hours = Number(manualInput?.value ?? selectedHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 20) {
      showToast('Introdu un numar valid de ore (1-20).');
      return;
    }
    openPaymentPage(student.id, student.studentName, hours);
  });
}

function paymentOptionBtn(key, hours, label, price) {
  return `
    <button class="pay-option" data-option="${key}" data-hours="${hours}" type="button"
            aria-label="${label}, ${hours * price} lei">
      ${label}<br><strong>${hours * price} lei</strong>
    </button>
  `;
}

// ── Render: Payment Page ──────────────────────────────────────

function renderPaymentPage() {
  if (!state.checkout) {
    els.paymentPage.innerHTML = `
      <section class="panel">
        <div class="empty-state">
          <strong>Nu exista o plata selectata.</strong>
          <span>Intoarce-te in portalul parintelui si alege numarul de ore.</span>
        </div>
      </section>
    `;
    return;
  }

  const { studentName, hours, amountLei, method } = state.checkout;

  els.paymentPage.innerHTML = `
    <section class="panel checkout-panel">
      <div class="checkout-summary">
        <div class="metric"><span>Elev</span><strong>${escapeHtml(studentName)}</strong></div>
        <div class="metric"><span>Ore selectate</span><strong>${hours}</strong></div>
        <div class="metric"><span>Total</span><strong>${amountLei} lei</strong></div>
      </div>

      <div class="method-switch" role="group" aria-label="Metoda de plata">
        <button class="${method === 'bank'    ? 'active' : ''}" data-method="bank"    type="button">Transfer bancar</button>
        <button class="${method === 'revolut' ? 'active' : ''}" data-method="revolut" type="button">Revolut</button>
        <button class="${method === 'btpay'   ? 'active' : ''}" data-method="btpay"   type="button">BT Pay</button>
      </div>

      <div id="payment-details-box">
        <div class="transfer-box checkout-details">
          ${renderPaymentDetails(amountLei, studentName)}
        </div>
        <div class="form-actions" style="margin-top:14px">
          <button id="confirm-payment-btn" type="button">
            Am efectuat plata – notifica profesorul
          </button>
        </div>
        <p class="hint">
          Apasa butonul de mai sus dupa ce ai facut transferul.
          Profesorul va confirma manual plata.
        </p>
      </div>

      <div id="payment-confirm-box" class="hidden">
        <div class="empty-state" style="border-color:var(--green); background:var(--green-soft)">
          <strong style="color:var(--green)">✓ Plata a fost inregistrata!</strong>
          <span>Profesorul va confirma in curand. Multumim!</span>
        </div>
      </div>
    </section>
  `;

  // Method switch
  els.paymentPage.querySelectorAll('[data-method]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.checkout.method = btn.dataset.method;
      renderPaymentPage();
    });
  });

  // Copy buttons
  els.paymentPage.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => copyToClipboard(btn.dataset.copy));
  });

  // Confirm button
  document.querySelector('#confirm-payment-btn')?.addEventListener('click', handleConfirmPayment);
}

function renderPaymentDetails(amountLei, studentName) {
  const { method } = state.checkout;
  const { iban, revolut, btPay } = state.settings ?? {};
  const details = `${studentName} - meditatii`;

  if (method === 'revolut') {
    return `
      <div class="row-title">
        <strong>Date pentru Revolut</strong>
        <span>Cauta tag-ul Revolut si trimite suma afisata.</span>
      </div>
      ${copyLine('Revolut', revolut || 'Tag Revolut nesetat – contacteaza profesorul')}
      ${copyLine('Suma', `${amountLei} lei`)}
      ${copyLine('Detalii', details)}
    `;
  }
  if (method === 'btpay') {
    return `
      <div class="row-title">
        <strong>Date pentru BT Pay</strong>
        <span>Trimite prin BT Pay la numarul de telefon afisat.</span>
      </div>
      ${copyLine('Telefon BT Pay', btPay || 'Numar nesetat – contacteaza profesorul')}
      ${copyLine('Suma', `${amountLei} lei`)}
    `;
  }
  // default: bank transfer
  return `
    <div class="row-title">
      <strong>Date pentru transfer bancar</strong>
      <span>Foloseste suma si detaliile de mai jos in aplicatia bancii.</span>
    </div>
    ${copyLine('IBAN', iban || 'IBAN nesetat – contacteaza profesorul')}
    ${copyLine('Suma', `${amountLei} lei`)}
    ${copyLine('Detalii plata', details)}
  `;
}

function copyLine(label, value) {
  const safe = escapeHtml(value);
  const attr = escapeAttr(value);
  return `
    <div class="transfer-line">
      <span>${escapeHtml(label)}</span>
      <div class="copy-value">
        <code>${safe}</code>
        <button class="copy-button" data-copy="${attr}" type="button" aria-label="Copiaza ${escapeAttr(label)}">
          Copiaza
        </button>
      </div>
    </div>
  `;
}

// ── Render: Admin ─────────────────────────────────────────────

function renderAdmin() {
  renderAdminMetrics();
  renderSettings();
  renderStudents();
  renderAdminCalendar();
  renderPaymentsList();
}

function renderAdminMetrics() {
  const bookedCount   = state.slots.filter(s => s.status === 'booked').length;
  const freeCount     = state.slots.filter(s => s.status === 'free').length;
  const pendingPayments = state.payments.filter(p => p.status === 'pending').length;

  els.adminMetrics.innerHTML = `
    <div class="metric">
      <span>Elevi activi</span>
      <strong>${state.students.length}</strong>
    </div>
    <div class="metric">
      <span>Ore ocupate</span>
      <strong>${bookedCount}</strong>
    </div>
    <div class="metric">
      <span>Ore libere</span>
      <strong>${freeCount}</strong>
    </div>
    <div class="metric">
      <span>Plati in asteptare</span>
      <strong>${pendingPayments}</strong>
    </div>
  `;
}

function renderSettings() {
  const s = state.settings;
  if (!s) return;
  els.settingsIban.value    = s.iban    ?? '';
  els.settingsRevolut.value = s.revolut ?? '';
  els.settingsBtPay.value   = s.btPay   ?? '';
  els.settingsPrice.value   = s.pricePerHour ?? 50;
}

function renderStudents() {
  if (!state.students.length) {
    els.studentList.innerHTML = emptyLine('Nu exista elevi.');
    return;
  }

  els.studentList.innerHTML = state.students.map(student => `
    <div class="student-row">
      <div class="row-title">
        <strong>${escapeHtml(student.studentName)}</strong>
        <span>${student.parentName ? escapeHtml(student.parentName) + ' – ' : ''}${escapeHtml(student.phone)}</span>
        ${student.notes ? `<span class="hint" style="font-size:0.82rem">${escapeHtml(student.notes)}</span>` : ''}
      </div>
      <div class="row-actions">
        <button data-edit-id="${escapeAttr(student.id)}"   type="button">Editeaza</button>
        <button data-delete-id="${escapeAttr(student.id)}" type="button" class="danger">Sterge</button>
      </div>
    </div>
  `).join('');

  els.studentList.querySelectorAll('[data-edit-id]').forEach(btn => {
    const student = state.students.find(s => s.id === btn.dataset.editId);
    if (student) btn.addEventListener('click', () => fillStudentForm(student));
  });
  els.studentList.querySelectorAll('[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteStudent(btn.dataset.deleteId));
  });
}

function renderAdminCalendar() {
  const ALL_DAYS = ['Luni', 'Marti', 'Miercuri', 'Joi', 'Vineri', 'Sambata', 'Duminica'];
  const activeDays = ALL_DAYS.filter(d => state.slots.some(s => s.day === d));
  els.adminCalendar.innerHTML = buildTimeGrid(activeDays, state.slots, true);
}

function renderPaymentsList() {
  if (!els.paymentsList) return;

  if (!state.payments.length) {
    els.paymentsList.innerHTML = emptyLine('Nu exista plati inregistrate.');
    return;
  }

  const statusLabel = { pending: 'In asteptare', confirmed: 'Confirmata', cancelled: 'Anulata' };
  const methodLabel = { bank: 'Transfer', revolut: 'Revolut', btpay: 'BT Pay' };

  els.paymentsList.innerHTML = state.payments.map(p => {
    const date = new Date(p.createdAt).toLocaleDateString('ro-RO');
    return `
      <div class="payment-row">
        <div class="row-title">
          <strong>${escapeHtml(p.studentName)}</strong>
          <span>${p.hours} ore · ${p.amountLei} lei · ${methodLabel[p.method] ?? p.method} · ${date}</span>
        </div>
        <div class="row-actions" style="align-items:center;gap:8px">
          <span class="pill ${p.status}">${statusLabel[p.status] ?? p.status}</span>
          ${p.status === 'pending' ? `
            <button data-confirm-payment="${escapeAttr(p.id)}" type="button" style="background:var(--green)">Confirma</button>
            <button data-cancel-payment="${escapeAttr(p.id)}"  type="button" class="danger">Anuleaza</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  els.paymentsList.querySelectorAll('[data-confirm-payment]').forEach(btn => {
    btn.addEventListener('click', () => handlePaymentStatusChange(btn.dataset.confirmPayment, 'confirmed'));
  });
  els.paymentsList.querySelectorAll('[data-cancel-payment]').forEach(btn => {
    btn.addEventListener('click', () => handlePaymentStatusChange(btn.dataset.cancelPayment, 'cancelled'));
  });
}

// ── Navigation ────────────────────────────────────────────────

function navigateTo(view) {
  const validViews = ['portal', 'calendar', 'admin', 'payment'];
  if (!validViews.includes(view)) view = 'portal';

  document.querySelectorAll('.view').forEach(section => {
    section.classList.toggle('active', section.id === view);
  });
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  window.location.hash = view;
}

// ── Utilities ─────────────────────────────────────────────────

function getCalendarDays() {
  const order = ['Luni', 'Marti', 'Miercuri', 'Joi', 'Vineri', 'Sambata', 'Duminica'];
  const days  = [...new Set(state.slots.map(s => s.day))];
  return days.sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function getCalendarTimes() {
  return [...new Set(state.slots.map(s => s.time))].sort((a, b) => parseTime(a) - parseTime(b));
}

function parseTime(time) {
  const raw = String(time ?? '').trim();
  const [start] = raw.split('-').map(part => part.trim());
  const parts = start.split(':').map(Number);
  const [h, m] = parts;
  return Number.isFinite(h) ? h * 60 + (m || 0) : 0;
}

function parseTimeRange(time) {
  const raw = String(time ?? '').trim();
  const [start, end] = raw.split('-').map(part => part.trim());
  const startMin = parseTime(start);
  const endMin = parseTime(end);
  return [startMin, endMin > startMin ? endMin : startMin + 60];
}

function emptyLine(text) {
  return `<div class="empty-state"><strong>${escapeHtml(text)}</strong></div>`;
}

function setLoading(key, value) {
  state.loading[key] = value;
  // Optional: could show a global loading indicator here
}

let toastTimer;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3000);
}

async function copyToClipboard(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      // Fallback for older browsers
      const ta = Object.assign(document.createElement('textarea'), {
        value, readOnly: true,
        style: 'position:fixed;opacity:0',
      });
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    showToast('Copiat!');
  } catch {
    showToast('Nu s-a putut copia automat.');
  }
}

// ── Start ─────────────────────────────────────────────────────

init();