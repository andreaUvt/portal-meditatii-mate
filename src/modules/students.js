// src/modules/students.js
// ─────────────────────────────────────────────────────────────
// All database operations for the students table.
// Input validation lives here so the UI stays thin.
// ─────────────────────────────────────────────────────────────
import { supabase } from '../lib/supabase.js';
import { sanitizeText, sanitizePhone, ValidationError } from './validation.js';

// ── helpers ──────────────────────────────────────────────────

function mapRow(row) {
  // Normalise DB snake_case → camelCase used by the UI
  return {
    id:          row.id,
    studentName: row.student_name,
    parentName:  row.parent_name,
    phone:       row.phone,
    notes:       row.notes ?? '',
    createdAt:   row.created_at,
  };
}

// ── public API ────────────────────────────────────────────────

/**
 * Fetch all active (non-deleted) students.
 * Admin-only: RLS enforces auth.role() = 'authenticated'.
 */
export async function fetchStudents() {
  const { data, error } = await supabase
    .from('students')
    .select('id, student_name, parent_name, phone, notes, created_at')
    .is('deleted_at', null)
    .order('student_name');

  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/**
 * Look up a student by phone number (parent portal, anon access).
 * Returns only safe fields – no notes, no parent details.
 *
 * @param {string} rawPhone
 * @returns {{ id, studentName, parentName, phone } | null}
 */
export async function lookupStudentByPhone(rawPhone) {
  const phone = sanitizePhone(rawPhone);
  if (!phone) return null;

  // Try exact match, then normalised variants
  const variants = phoneVariants(phone);

  const { data, error } = await supabase
    .from('students')
    .select('id, student_name, parent_name, phone')
    .is('deleted_at', null)
    .in('phone', variants)
    .limit(1);

  if (error) throw error;
  if (!data?.length) return null;

  const row = data[0];
  return {
    id:          row.id,
    studentName: row.student_name,
    parentName:  row.parent_name,
    phone:       row.phone,
  };
}

/**
 * Create or update a student.
 * Validates input before touching the DB.
 *
 * @param {{ id?, studentName, parentName, phone, notes }} input
 * @returns {Promise<{ id, studentName, parentName, phone, notes }>}
 */
export async function saveStudent(input) {
  const studentName = sanitizeText(input.studentName, 'Nume elev', 100);
  const parentName  = sanitizeText(input.parentName,  'Parinte',   100);
  const phone       = sanitizePhone(input.phone);
  const notes       = sanitizeText(input.notes ?? '', 'Observatii', 500, false);

  if (!phone) throw new ValidationError('Telefonul nu este valid.');

  const payload = {
    student_name: studentName,
    parent_name:  parentName,
    phone,
    notes,
  };

  if (input.id) {
    // Update existing
    const { data, error } = await supabase
      .from('students')
      .update(payload)
      .eq('id', input.id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) throw error;
    return mapRow(data);
  } else {
    // Insert new
    const { data, error } = await supabase
      .from('students')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return mapRow(data);
  }
}

/**
 * Soft-delete a student.
 * Sets deleted_at; the record is retained for payment history.
 */
export async function deleteStudent(id) {
  const { error } = await supabase
    .from('students')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

// ── private helpers ───────────────────────────────────────────

/**
 * Generate phone number variants to handle formatting differences.
 * e.g. "0775147463" → ["0775147463", "40775147463", "+40775147463"]
 */
function phoneVariants(phone) {
  const digits = phone.replace(/\D/g, '');
  const variants = [digits];

  if (digits.startsWith('0') && digits.length === 10) {
    variants.push(`40${digits.slice(1)}`);    // national → intl without +
    variants.push(`+40${digits.slice(1)}`);   // national → intl with +
  } else if (digits.startsWith('40') && digits.length === 11) {
    variants.push(`0${digits.slice(2)}`);     // intl → national
    variants.push(`+${digits}`);
  } else if (digits.startsWith('40') && digits.length === 12) {
    variants.push(`0${digits.slice(3)}`);
  }

  return [...new Set(variants)];
}
