// src/modules/slots.js
// ─────────────────────────────────────────────────────────────
// Database operations for the weekly schedule slots.
// ─────────────────────────────────────────────────────────────
import { supabase } from '../lib/supabase.js';

const VALID_STATUSES = ['free', 'booked'];
const VALID_DAYS = ['Luni', 'Marti', 'Miercuri', 'Joi', 'Vineri', 'Sambata', 'Duminica'];

/**
 * Fetch all slots (public – used by the calendar page).
 * Returns a flat array sorted by day-order then time.
 */
export async function fetchSlots() {
  const { data, error } = await supabase
    .from('slots')
    .select('id, day, time, status, student_id')
    .order('day')
    .order('time');

  if (error) throw error;
  return (data ?? []).map(mapSlot);
}

/**
 * Fetch slots with student names joined (admin view).
 */
export async function fetchSlotsWithStudents() {
  const { data, error } = await supabase
    .from('slots')
    .select('id, day, time, status, student_id, students(student_name, phone)')
    .order('day')
    .order('time');

  if (error) throw error;
  return (data ?? []).map(row => ({
    ...mapSlot(row),
    studentName: row.students?.student_name ?? null,
    studentPhone: row.students?.phone ?? null,
  }));
}

/**
 * Save multiple slot updates at once (admin "Save all" button).
 * Each item: { id, status, studentId }
 *
 * Uses individual UPDATE calls (not upsert) so we only touch
 * the columns we're changing. Upsert would require sending all
 * NOT NULL columns (day, time) which we don't have here.
 */
export async function saveSlotsBatch(updates) {
  // Validate first – fail fast before any DB calls
  for (const slot of updates) {
    if (!VALID_STATUSES.includes(slot.status)) {
      throw new Error(`Status invalid: ${slot.status}`);
    }
    if (slot.status === 'booked' && !slot.studentId) {
      throw new Error('Un slot ocupat trebuie sa aiba un elev asignat.');
    }
  }

  // Run all updates in parallel
  const promises = updates.map(slot =>
    supabase
      .from('slots')
      .update({
        status:     slot.status,
        student_id: slot.status === 'booked' ? slot.studentId : null,
      })
      .eq('id', slot.id)
  );

  const results = await Promise.all(promises);

  // Check if any update failed
  const failed = results.find(r => r.error);
  if (failed) throw failed.error;
}

/**
 * Update a single slot.
 */
export async function saveSlot({ id, status, studentId }) {
  if (!VALID_STATUSES.includes(status)) throw new Error('Status invalid.');
  if (status === 'booked' && !studentId) {
    throw new Error('Alege un elev pentru ora ocupata.');
  }

  const { error } = await supabase
    .from('slots')
    .update({
      status,
      student_id: status === 'booked' ? studentId : null,
    })
    .eq('id', id);

  if (error) throw error;
}

// ── private ───────────────────────────────────────────────────

function mapSlot(row) {
  return {
    id:        row.id,
    day:       row.day,
    time:      row.time,
    status:    row.status,
    studentId: row.student_id ?? null,
  };
}