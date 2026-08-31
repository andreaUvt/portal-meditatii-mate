// src/modules/students.js
// ─────────────────────────────────────────────────────────────
// All database operations for the students table.
// Students now carry their plan (weekly hours, exam year, prepaid
// months, monthly price, status) — admin-only, no phone lookup.
// Input validation lives here so the UI stays thin.
// ─────────────────────────────────────────────────────────────
import { supabase } from '../lib/supabase.js';
import { sanitizeText, sanitizePhone, ValidationError } from './validation.js';

const VALID_PLAN_TYPES = ['1h', '2h', '3h', '4h'];
const VALID_STATUSES   = ['activ', 'pauza', 'inactiv'];

// ── helpers ──────────────────────────────────────────────────

function mapRow(row) {
  // Normalise DB snake_case → camelCase used by the UI
  return {
    id:             row.id,
    studentName:    row.student_name,
    parentName:     row.parent_name,
    phone:          row.phone,
    grade:          row.grade ?? '',
    examYear:       !!row.exam_year,
    planType:       row.plan_type ?? '2h',
    prepaidMonths:  row.prepaid_months ?? 0,
    monthlyPrice:   row.monthly_price ?? 480,
    status:         row.status ?? 'activ',
    notes:          row.notes ?? '',
    createdAt:      row.created_at,
  };
}

// ── public API ────────────────────────────────────────────────

/**
 * Fetch all active (non-deleted) students, admin-only.
 */
export async function fetchStudents() {
  const { data, error } = await supabase
    .from('students')
    .select('id, student_name, parent_name, phone, grade, exam_year, plan_type, prepaid_months, monthly_price, status, notes, created_at')
    .is('deleted_at', null)
    .order('student_name');

  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/**
 * Create or update a student.
 * Validates input before touching the DB.
 */
export async function saveStudent(input) {
  const studentName = sanitizeText(input.studentName, 'Nume elev', 100);
  const parentName  = sanitizeText(input.parentName,  'Parinte',   100);
  const phone       = sanitizePhone(input.phone);
  const grade       = sanitizeText(input.grade ?? '', 'Clasa', 30, false);
  const notes       = sanitizeText(input.notes ?? '', 'Observatii', 500, false);
  const planType    = VALID_PLAN_TYPES.includes(input.planType) ? input.planType : '2h';
  const status      = VALID_STATUSES.includes(input.status) ? input.status : 'activ';
  const examYear    = !!input.examYear;

  const prepaidMonths = Number(input.prepaidMonths);
  const monthlyPrice  = Number(input.monthlyPrice);

  if (!phone) throw new ValidationError('Telefonul nu este valid.');
  if (!Number.isInteger(prepaidMonths) || prepaidMonths < 0) {
    throw new ValidationError('Lunile platite in avans trebuie sa fie un numar valid.');
  }
  if (!Number.isInteger(monthlyPrice) || monthlyPrice < 1 || monthlyPrice > 99999) {
    throw new ValidationError('Pretul lunar trebuie sa fie un numar valid.');
  }

  const payload = {
    student_name:    studentName,
    parent_name:     parentName,
    phone,
    grade,
    exam_year:       examYear,
    plan_type:       planType,
    prepaid_months:  prepaidMonths,
    monthly_price:   monthlyPrice,
    status,
    notes,
  };

  if (input.id) {
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