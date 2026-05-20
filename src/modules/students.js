// src/modules/students.js
import { supabase } from '../lib/supabase.js';
import { sanitizeText, sanitizePhone, ValidationError } from './validation.js';

function mapRow(row) {
  return {
    id:          row.id,
    studentName: row.student_name,
    parentName:  row.parent_name ?? '',
    phone:       row.phone,
    notes:       row.notes ?? '',
    createdAt:   row.created_at,
  };
}

/**
 * Fetch all active (non-deleted) students.
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
 * Look up students by phone number (parent portal, anon access).
 * Returns an ARRAY – multiple students can share the same phone
 * (e.g. two siblings whose parent uses one number).
 * Returns [] if nothing found.
 */
export async function lookupStudentByPhone(rawPhone) {
  const phone = sanitizePhone(rawPhone);
  if (!phone) return [];

  const variants = phoneVariants(phone);

  const { data, error } = await supabase
    .from('students')
    .select('id, student_name, parent_name, phone')
    .is('deleted_at', null)
    .in('phone', variants)
    .order('student_name');

  if (error) throw error;
  if (!data?.length) return [];

  return data.map(row => ({
    id:          row.id,
    studentName: row.student_name,
    parentName:  row.parent_name ?? '',
    phone:       row.phone,
  }));
}

/**
 * Create or update a student.
 * parentName is optional – leave blank if unknown.
 * Multiple students may share the same phone number.
 */
export async function saveStudent(input) {
  const studentName = sanitizeText(input.studentName, 'Nume elev', 100);
  // parentName is optional
  const parentName  = sanitizeText(input.parentName ?? '', 'Parinte', 100, false);
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
 */
export async function deleteStudent(id) {
  const { error } = await supabase
    .from('students')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

// ── private ───────────────────────────────────────────────────

function phoneVariants(phone) {
  const digits = phone.replace(/\D/g, '');
  const variants = [digits];

  if (digits.startsWith('0') && digits.length === 10) {
    variants.push(`40${digits.slice(1)}`);
    variants.push(`+40${digits.slice(1)}`);
  } else if (digits.startsWith('40') && digits.length === 11) {
    variants.push(`0${digits.slice(2)}`);
    variants.push(`+${digits}`);
  } else if (digits.startsWith('40') && digits.length === 12) {
    variants.push(`0${digits.slice(3)}`);
  }

  return [...new Set(variants)];
}