// src/app.js
// ─────────────────────────────────────────────────────────────
// Portal Meditatii Mate – Main Application
//
// Architecture:
//   • Public site = single scrolling page (hero/despre/planuri/inscriere)
//   • Admin = a separate hidden panel, reached via a footer link,
//     never part of the public nav
//   • All data is fetched from Supabase (PostgreSQL via REST API)
//   • No parent account / phone-lookup portal — leads come in via
//     the signup form and are triaged by the admin
//   • All user-supplied strings are HTML-escaped before rendering
// ─────────────────────────────────────────────────────────────

import { supabase }                             from './lib/supabase.js';
import { adminSignIn, adminSignOut, getSession, onAuthChange } from './modules/auth.js';
import { fetchStudents, saveStudent, deleteStudent }           from './modules/students.js';
import { submitLead, fetchLeads, updateLeadStatus }             from './modules/leads.js';
import { fetchPaymentSettings, savePaymentSettings, createPayment, fetchPayments, updatePaymentStatus } from './modules/payments.js';
import { escapeHtml, escapeAttr, ValidationError }             from './modules/validation.js';

// ── App State ─────────────────────────────────────────────────

const state = {
  adminSession: null,
  settings:     null,
  students:     [],
  leads:        [],
  payments:     [],
  loading:      {},
};

// ── DOM References ────────────────────────────────────────────

const els = {
  toast:              document.querySelector('#toast'),
  sitePublic:         document.querySelector('#site-public'),
  siteAdmin:          document.querySelector('#site-admin'),
  hamburger:          document.querySelector('#hamburger'),
  mobileMenu:         document.querySelector('#mobile-menu'),
  adminLink:          document.querySelector('#admin-link'),
  adminBack:          document.querySelector('#admin-back'),
  signupForm:         document.querySelector('#signup-form'),
  formSuccess:        document.querySelector('#form-success'),
  paymentMethods:     document.querySelector('#payment-methods'),
  adminLoginBox:      document.querySelector('#admin-login'),
  adminLoginForm:     document.querySelector('#admin-login-form'),
  adminEmail:         document.querySelector('#admin-email'),
  adminPassword:      document.querySelector('#admin-password'),
  adminLoginError:    document.querySelector('#admin-login-error'),
  adminView:          document.querySelector('#admin-view'),
  adminMetrics:       document.querySelector('#admin-metrics'),
  adminLogout:        document.querySelector('#admin-logout'),
  settingsForm:       document.querySelector('#settings-form'),
  settingsIban:       document.querySelector('#settings-iban'),
  settingsRevolut:    document.querySelector('#settings-revolut'),
  settingsBtPay:      document.querySelector('#settings-btpay'),
  settingsPrice:      document.querySelector('#settings-price'),
  studentForm:        document.querySelector('#student-form'),
  studentIdInput:     document.querySelector('#student-id'),
  studentName:        document.querySelector('#student-name'),
  parentName:         document.querySelector('#parent-name'),
  studentPhone:       document.querySelector('#student-phone'),
  studentGrade:       document.querySelector('#student-grade'),
  studentExamYear:    document.querySelector('#student-exam-year'),
  studentPlanType:    document.querySelector('#student-plan-type'),
  studentPrepaidMonths: document.querySelector('#student-prepaid-months'),
  studentMonthlyPrice: document.querySelector('#student-monthly-price'),
  studentStatus:      document.querySelector('#student-status'),
  studentNotes:       document.querySelector('#student-notes'),
  clearStudent:       document.querySelector('#clear-student'),
  studentList:        document.querySelector('#student-list'),
  leadList:           document.querySelector('#lead-list'),
  paymentForm:        document.querySelector('#payment-form'),
  paymentStudentId:   document.querySelector('#payment-student-id'),
  paymentUnits:       document.querySelector('#payment-units'),
  paymentAmount:      document.querySelector('#payment-amount'),
  paymentMethod:      document.querySelector('#payment-method'),
  paymentStatus:      document.querySelector('#payment-status'),
  paymentNotes:       document.querySelector('#payment-notes'),
  paymentsList:       document.querySelector('#payments-list'),
};

// ── Bootstrap ─────────────────────────────────────────────────

async function init() {
  state.adminSession = await getSession();

  onAuthChange((event, session) => {
    state.adminSession = session;
    if (event === 'SIGNED_OUT') {
      showAdminLogin();
    } else if (event === 'SIGNED_IN') {
      onAdminSignedIn();
    }
  });

  wireNav();
  wireForms();

  // Only "#admin" switches modes; any other hash is a normal in-page
  // anchor on the public site and needs no special handling.
  if (window.location.hash.replace('#', '') === 'admin') {
    showAdminMode();
  } else {
    showPublicMode();
  }

  await Promise.all([
    loadPublicData(),
    state.adminSession ? onAdminSignedIn() : Promise.resolve(),
  ]);
}

function wireNav() {
  if (els.hamburger && els.mobileMenu) {
    els.hamburger.addEventListener('click', () => {
      const open = els.mobileMenu.classList.toggle('open');
      els.hamburger.classList.toggle('open', open);
      els.hamburger.setAttribute('aria-expanded', String(open));
    });
    els.mobileMenu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        els.mobileMenu.classList.remove('open');
        els.hamburger.classList.remove('open');
        els.hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  els.adminLink?.addEventListener('click', (e) => {
    e.preventDefault();
    showAdminMode();
  });
  els.adminBack?.addEventListener('click', (e) => {
    e.preventDefault();
    showPublicMode();
  });
}

function wireForms() {
  els.signupForm?.addEventListener('submit', handleSignupSubmit);
  els.adminLoginForm.addEventListener('submit', handleAdminLogin);
  els.studentForm.addEventListener('submit', handleStudentSave);
  els.settingsForm.addEventListener('submit', handleSettingsSave);
  els.clearStudent.addEventListener('click', clearStudentForm);
  els.adminLogout.addEventListener('click', handleAdminLogout);
  els.paymentForm.addEventListener('submit', handlePaymentSave);
}

function showAdminMode() {
  els.sitePublic.classList.add('hidden');
  els.siteAdmin.classList.remove('hidden');
  window.location.hash = 'admin';
  window.scrollTo({ top: 0 });
}

function showPublicMode() {
  els.siteAdmin.classList.add('hidden');
  els.sitePublic.classList.remove('hidden');
  if (window.location.hash.replace('#', '') === 'admin') {
    history.replaceState(null, '', window.location.pathname);
  }
}

// ── Public Data (no auth required) ───────────────────────────

async function loadPublicData() {
  try {
    state.settings = await fetchPaymentSettings();
    renderPaymentMethods();
  } catch (err) {
    console.error('Failed to load public data:', err);
  }
}

function renderPaymentMethods() {
  if (!els.paymentMethods) return;
  const s = state.settings;
  if (!s) return;

  const rows = [
    ['IBAN', s.iban],
    ['Revolut', s.revolut],
    ['BT Pay', s.btPay],
  ].filter(([, value]) => value);

  if (!rows.length) {
    els.paymentMethods.innerHTML = emptyLine('Detaliile de plata vor fi disponibile in curand.');
    return;
  }

  els.paymentMethods.innerHTML = rows.map(([label, value]) => `
    <div class="payment-method-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join('');
}

// ── Signup form (public leads) ──────────────────────────────

async function handleSignupSubmit(event) {
  event.preventDefault();

  // Client-side required-field check, mirrors the field-highlight pattern
  const required = els.signupForm.querySelectorAll('[required]');
  let valid = true;
  required.forEach(el => {
    el.style.borderColor = '';
    if (!el.value.trim()) {
      el.style.borderColor = '#e05050';
      valid = false;
    }
  });
  if (!valid) return;

  const btn = els.signupForm.querySelector('button[type=submit]');
  btn.disabled = true;

  try {
    await submitLead({
      studentName: document.querySelector('#signup-student-name').value,
      parentName:  document.querySelector('#signup-parent-name').value,
      phone:       document.querySelector('#signup-phone').value,
      grade:       document.querySelector('#signup-grade').value,
      desiredPlan: document.querySelector('#signup-plan').value,
      desiredPrepay: document.querySelector('#signup-prepay').value,
      message:     document.querySelector('#signup-message').value,
    });
    els.signupForm.style.display = 'none';
    if (els.formSuccess) els.formSuccess.style.display = 'block';
  } catch (err) {
    showToast(err instanceof ValidationError ? err.message : 'Nu am putut trimite cererea. Incearca din nou.');
  } finally {
    btn.disabled = false;
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
    const [students, leads, settings, payments] = await Promise.all([
      fetchStudents(),
      fetchLeads(),
      fetchPaymentSettings(),
      fetchPayments(),
    ]);
    state.students = students;
    state.leads    = leads;
    state.settings = settings;
    state.payments = payments;

    renderAdmin();
    renderPaymentMethods();
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
  state.students = [];
  state.leads    = [];
  state.payments = [];
  showToast('Ai iesit din cont.');
}

// ── Students ──────────────────────────────────────────────────

async function handleStudentSave(event) {
  event.preventDefault();
  const btn = els.studentForm.querySelector('button[type=submit]');
  btn.disabled = true;

  try {
    await saveStudent({
      id:             els.studentIdInput.value || undefined,
      studentName:    els.studentName.value,
      parentName:     els.parentName.value,
      phone:          els.studentPhone.value,
      grade:          els.studentGrade.value,
      examYear:       els.studentExamYear.checked,
      planType:       els.studentPlanType.value,
      prepaidMonths:  els.studentPrepaidMonths.value,
      monthlyPrice:   els.studentMonthlyPrice.value,
      status:         els.studentStatus.value,
      notes:          els.studentNotes.value,
    });
    showToast('Elev salvat.');
    clearStudentForm();
    await loadAdminData();
  } catch (err) {
    showToast(err instanceof ValidationError ? err.message : 'Eroare la salvarea elevului.');
  } finally {
    btn.disabled = false;
  }
}

function fillStudentForm(student) {
  els.studentIdInput.value = student.id;
  els.studentName.value = student.studentName;
  els.parentName.value = student.parentName;
  els.studentPhone.value = student.phone;
  els.studentGrade.value = student.grade;
  els.studentExamYear.checked = student.examYear;
  els.studentPlanType.value = student.planType;
  els.studentPrepaidMonths.value = student.prepaidMonths;
  els.studentMonthlyPrice.value = student.monthlyPrice;
  els.studentStatus.value = student.status;
  els.studentNotes.value = student.notes;
  els.studentForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearStudentForm() {
  els.studentForm.reset();
  els.studentIdInput.value = '';
  els.studentPrepaidMonths.value = 0;
  els.studentMonthlyPrice.value = 480;
}

async function handleDeleteStudent(id) {
  if (!confirm('Stergi acest elev?')) return;
  try {
    await deleteStudent(id);
    showToast('Elev sters.');
    await loadAdminData();
  } catch {
    showToast('Eroare la stergere.');
  }
}

// ── Leads ────────────────────────────────────────────────────

async function handleLeadStatusChange(id, status) {
  try {
    await updateLeadStatus(id, status);
    await loadAdminData();
  } catch {
    showToast('Eroare la actualizarea cererii.');
  }
}

// ── Settings ─────────────────────────────────────────────────

async function handleSettingsSave(event) {
  event.preventDefault();
  const btn = els.settingsForm.querySelector('button[type=submit]');
  btn.disabled = true;

  try {
    await savePaymentSettings({
      iban:         els.settingsIban.value,
      revolut:      els.settingsRevolut.value,
      btPay:        els.settingsBtPay.value,
      pricePerHour: els.settingsPrice.value,
    });
    showToast('Date de plata salvate.');
    await loadAdminData();
  } catch (err) {
    showToast(err instanceof ValidationError ? err.message : 'Eroare la salvare.');
  } finally {
    btn.disabled = false;
  }
}

// ── Payments ─────────────────────────────────────────────────

async function handlePaymentSave(event) {
  event.preventDefault();
  const btn = els.paymentForm.querySelector('button[type=submit]');
  btn.disabled = true;

  try {
    await createPayment({
      studentId: els.paymentStudentId.value,
      hours:     Number(els.paymentUnits.value),
      amountLei: Number(els.paymentAmount.value),
      method:    els.paymentMethod.value,
      status:    els.paymentStatus.value,
      notes:     els.paymentNotes.value,
    });
    showToast('Plata inregistrata.');
    els.paymentForm.reset();
    els.paymentUnits.value = 1;
    await loadAdminData();
  } catch (err) {
    showToast(err instanceof ValidationError ? err.message : 'Eroare la inregistrarea platii.');
  } finally {
    btn.disabled = false;
  }
}

async function handlePaymentStatusChange(id, status) {
  try {
    await updatePaymentStatus(id, status, '');
    await loadAdminData();
  } catch {
    showToast('Eroare la actualizarea platii.');
  }
}

// ── Render: Admin ─────────────────────────────────────────────

function renderAdmin() {
  renderAdminMetrics();
  renderSettings();
  renderStudents();
  renderLeads();
  renderPaymentStudentOptions();
  renderPaymentsList();
}

function renderAdminMetrics() {
  const activeStudents  = state.students.filter(s => s.status === 'activ').length;
  const newLeads        = state.leads.filter(l => l.status === 'nou').length;
  const pendingPayments = state.payments.filter(p => p.status === 'pending').length;
  const totalPrepaid    = state.students.reduce((sum, s) => sum + (s.prepaidMonths || 0), 0);

  els.adminMetrics.innerHTML = `
    <div class="metric"><span>Elevi activi</span><strong>${activeStudents}</strong></div>
    <div class="metric"><span>Cereri noi</span><strong>${newLeads}</strong></div>
    <div class="metric"><span>Plati in asteptare</span><strong>${pendingPayments}</strong></div>
    <div class="metric"><span>Luni prepaid (total)</span><strong>${totalPrepaid}</strong></div>
  `;
}

function renderSettings() {
  const s = state.settings;
  if (!s) return;
  els.settingsIban.value    = s.iban    ?? '';
  els.settingsRevolut.value = s.revolut ?? '';
  els.settingsBtPay.value   = s.btPay   ?? '';
  els.settingsPrice.value   = s.pricePerHour ?? 65;
}

const PLAN_LABEL   = { '1h': '1 ora / saptamana', '2h': '1 sedinta (2 ore) / saptamana', '3h': '1 sedinta (2 ore) + 1 ora / saptamana', '4h': '2 sedinte (4 ore) / saptamana' };
const STATUS_LABEL = { activ: 'Activ', pauza: 'Pauza', inactiv: 'Inactiv' };

function renderStudents() {
  if (!state.students.length) {
    els.studentList.innerHTML = emptyLine('Nu exista elevi.');
    return;
  }

  els.studentList.innerHTML = state.students.map(student => `
    <div class="student-row">
      <div class="row-title">
        <strong>${escapeHtml(student.studentName)}${student.examYear ? ' · an de examen' : ''}</strong>
        <span>${student.parentName ? escapeHtml(student.parentName) + ' – ' : ''}${escapeHtml(student.phone)}${student.grade ? ' · clasa ' + escapeHtml(student.grade) : ''}</span>
        <span>${PLAN_LABEL[student.planType] ?? student.planType} · ${student.monthlyPrice} lei/luna · ${student.prepaidMonths} luni prepaid</span>
        ${student.notes ? `<span class="hint" style="font-size:0.82rem">${escapeHtml(student.notes)}</span>` : ''}
      </div>
      <div class="row-actions" style="align-items:center">
        <span class="pill ${student.status}">${STATUS_LABEL[student.status] ?? student.status}</span>
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

const LEAD_PLAN_LABEL   = { '1h': '1 ora / saptamana', '2h': '1 sedinta (2 ore) / saptamana', '3h': '1 sedinta (2 ore) + 1 ora / saptamana', '4h': '2 sedinte (4 ore) / saptamana', unsure: 'Nu stie inca' };
const LEAD_PREPAY_LABEL = { monthly: 'doar luna curenta', '2months': '2 luni in avans', '3months': '3+ luni in avans' };
const LEAD_STATUS_LABEL = { nou: 'Nou', contactat: 'Contactat', inscris: 'Inscris' };

function renderLeads() {
  if (!els.leadList) return;

  if (!state.leads.length) {
    els.leadList.innerHTML = emptyLine('Nu exista cereri noi.');
    return;
  }

  els.leadList.innerHTML = state.leads.map(lead => {
    const date = new Date(lead.createdAt).toLocaleDateString('ro-RO');
    return `
      <div class="lead-row">
        <div class="row-title">
          <strong>${escapeHtml(lead.studentName)}</strong>
          <span>${escapeHtml(lead.parentName)} – ${escapeHtml(lead.phone)}${lead.grade ? ' · clasa ' + escapeHtml(lead.grade) : ''}</span>
          <span>${LEAD_PLAN_LABEL[lead.desiredPlan] ?? lead.desiredPlan} · ${LEAD_PREPAY_LABEL[lead.desiredPrepay] ?? lead.desiredPrepay} · ${date}</span>
          ${lead.message ? `<span class="hint" style="font-size:0.82rem">${escapeHtml(lead.message)}</span>` : ''}
        </div>
        <div class="row-actions" style="align-items:center">
          <span class="pill ${lead.status}">${LEAD_STATUS_LABEL[lead.status] ?? lead.status}</span>
          <select data-lead-status="${escapeAttr(lead.id)}">
            <option value="nou"       ${lead.status === 'nou' ? 'selected' : ''}>Nou</option>
            <option value="contactat" ${lead.status === 'contactat' ? 'selected' : ''}>Contactat</option>
            <option value="inscris"   ${lead.status === 'inscris' ? 'selected' : ''}>Inscris</option>
          </select>
        </div>
      </div>
    `;
  }).join('');

  els.leadList.querySelectorAll('[data-lead-status]').forEach(select => {
    select.addEventListener('change', () => handleLeadStatusChange(select.dataset.leadStatus, select.value));
  });
}

function renderPaymentStudentOptions() {
  if (!els.paymentStudentId) return;
  const current = els.paymentStudentId.value;
  els.paymentStudentId.innerHTML = state.students.map(s =>
    `<option value="${escapeAttr(s.id)}">${escapeHtml(s.studentName)}</option>`
  ).join('');
  if (current) els.paymentStudentId.value = current;
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
          <span>${p.hours} unit. · ${p.amountLei} lei · ${methodLabel[p.method] ?? p.method} · ${date}</span>
        </div>
        <div class="row-actions" style="align-items:center">
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

// ── Utilities ─────────────────────────────────────────────────

function emptyLine(text) {
  return `<div class="empty-state"><strong>${escapeHtml(text)}</strong></div>`;
}

function setLoading(key, value) {
  state.loading[key] = value;
}

let toastTimer;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3000);
}

// ── Start ─────────────────────────────────────────────────────

init();