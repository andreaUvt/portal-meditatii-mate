// src/modules/payments.js
// ─────────────────────────────────────────────────────────────
// Payments and payment settings.
// ─────────────────────────────────────────────────────────────
import { supabase } from '../lib/supabase.js';
import { sanitizeText, ValidationError } from './validation.js';

const VALID_METHODS = ['bank', 'revolut', 'btpay'];
const VALID_STATUSES = ['pending', 'confirmed', 'cancelled'];

// ── Payment Settings ──────────────────────────────────────────

/**
 * Fetch the tutor's payment settings.
 * Public read (RLS allows anon SELECT).
 */
export async function fetchPaymentSettings() {
  const { data, error } = await supabase
    .from('payment_settings')
    .select('iban, revolut, bt_pay, price_per_hour')
    .eq('id', 1)
    .single();

  if (error) throw error;
  return {
    iban:         data.iban         ?? '',
    revolut:      data.revolut      ?? '',
    btPay:        data.bt_pay       ?? '',
    pricePerHour: data.price_per_hour ?? 50,
  };
}

/**
 * Save payment settings (admin only).
 */
export async function savePaymentSettings({ iban, revolut, btPay, pricePerHour }) {
  const cleanIban    = sanitizeText(iban    ?? '', 'IBAN',    50, false);
  const cleanRevolut = sanitizeText(revolut ?? '', 'Revolut', 50, false);
  const cleanBtPay   = sanitizeText(btPay   ?? '', 'BT Pay',  20, false);
  const price        = Number(pricePerHour);

  if (!Number.isInteger(price) || price < 1 || price > 9999) {
    throw new ValidationError('Pretul pe ora trebuie sa fie un numar valid.');
  }

  const { error } = await supabase
    .from('payment_settings')
    .update({ iban: cleanIban, revolut: cleanRevolut, bt_pay: cleanBtPay, price_per_hour: price })
    .eq('id', 1);

  if (error) throw error;
}

// ── Payments ──────────────────────────────────────────────────

/**
 * Record a pending payment intent (parent-facing).
 * Creates a pending record so admin can confirm later.
 *
 * @returns {string} payment id
 */
export async function createPayment({ studentId, hours, amountLei, method }) {
  if (!VALID_METHODS.includes(method)) throw new ValidationError('Metoda de plata invalida.');
  if (!Number.isInteger(hours) || hours < 1) throw new ValidationError('Numar de ore invalid.');
  if (!Number.isInteger(amountLei) || amountLei < 1) throw new ValidationError('Suma invalida.');

  const { data, error } = await supabase
    .from('payments')
    .insert({
      student_id: studentId,
      hours,
      amount_lei: amountLei,
      method,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/**
 * Fetch all payments for admin view, joined with student name.
 */
export async function fetchPayments() {
  const { data, error } = await supabase
    .from('payments')
    .select('id, hours, amount_lei, method, status, notes, created_at, students(student_name)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;
  return (data ?? []).map(row => ({
    id:          row.id,
    studentName: row.students?.student_name ?? '—',
    hours:       row.hours,
    amountLei:   row.amount_lei,
    method:      row.method,
    status:      row.status,
    notes:       row.notes,
    createdAt:   row.created_at,
  }));
}

/**
 * Update payment status (admin).
 */
export async function updatePaymentStatus(id, status, notes) {
  if (!VALID_STATUSES.includes(status)) throw new ValidationError('Status invalid.');
  const cleanNotes = sanitizeText(notes ?? '', 'Note', 500, false);

  const { error } = await supabase
    .from('payments')
    .update({ status, notes: cleanNotes })
    .eq('id', id);

  if (error) throw error;
}
