// src/modules/leads.js
// ─────────────────────────────────────────────────────────────
// Public "Planuri" page signup form → leads table.
// Anyone can insert (anon); only admin can read/update.
// ─────────────────────────────────────────────────────────────
import { supabase } from '../lib/supabase.js';
import { sanitizeText, sanitizePhone, ValidationError } from './validation.js';

const VALID_PLANS    = ['1h', '2h', '3h', '4h', 'unsure'];
const VALID_PREPAYS  = ['monthly', '2months', '3months'];
const VALID_STATUSES = ['nou', 'contactat', 'inscris'];

function mapRow(row) {
  return {
    id:           row.id,
    studentName:  row.student_name,
    parentName:   row.parent_name,
    phone:        row.phone,
    grade:        row.grade ?? '',
    desiredPlan:  row.desired_plan ?? 'unsure',
    desiredPrepay: row.desired_prepay ?? 'monthly',
    message:      row.message ?? '',
    status:       row.status ?? 'nou',
    createdAt:    row.created_at,
  };
}

/**
 * Submit a signup/inquiry (public, anon).
 */
export async function submitLead(input) {
  const studentName  = sanitizeText(input.studentName, 'Nume elev', 100);
  const parentName   = sanitizeText(input.parentName,  'Parinte',   100);
  const phone        = sanitizePhone(input.phone);
  const grade        = sanitizeText(input.grade ?? '', 'Clasa', 30, false);
  const message       = sanitizeText(input.message ?? '', 'Mesaj', 500, false);
  const desiredPlan   = VALID_PLANS.includes(input.desiredPlan) ? input.desiredPlan : 'unsure';
  const desiredPrepay = VALID_PREPAYS.includes(input.desiredPrepay) ? input.desiredPrepay : 'monthly';

  if (!phone) throw new ValidationError('Telefonul nu este valid.');

  const { error } = await supabase
    .from('leads')
    .insert({
      student_name:   studentName,
      parent_name:    parentName,
      phone,
      grade,
      desired_plan:   desiredPlan,
      desired_prepay: desiredPrepay,
      message,
    });

  if (error) throw error;
}

/**
 * Fetch all leads, newest first (admin only).
 */
export async function fetchLeads() {
  const { data, error } = await supabase
    .from('leads')
    .select('id, student_name, parent_name, phone, grade, desired_plan, desired_prepay, message, status, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/**
 * Update a lead's status (admin only).
 */
export async function updateLeadStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) throw new ValidationError('Status invalid.');

  const { error } = await supabase
    .from('leads')
    .update({ status })
    .eq('id', id);

  if (error) throw error;
}