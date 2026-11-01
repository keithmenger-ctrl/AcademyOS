import 'server-only'
import type { Q } from '@/lib/db'
import { parseCsv } from './csv'
import { checkGrid, validateRows, type ExistingAthlete, type ImportPreview, type ImportRow, type ProgramRef } from './validate'

export const TEMPLATE_HEADERS = [
  'First name', 'Last name', 'Date of birth', 'Sport', 'Position', 'School/team', 'Status',
  'Program', 'Level', 'Join date', 'Parent name', 'Parent email', 'Parent phone', 'Notes',
]

export type { ImportPreview, ImportRow } from './validate'

export async function previewImport(q: Q, text: string): Promise<ImportPreview> {
  const grid = parseCsv(text)
  const checked = checkGrid(grid)
  if (!('headers' in checked)) return checked
  const programs = await q<ProgramRef>(
    `select p.id, p.name, coalesce((select json_agg(json_build_object('id', l.id, 'name', l.name)) from program_levels l where l.program_id = p.id), '[]') as levels
       from programs p where p.active`)
  const existing = await q<ExistingAthlete>(
    `select lower(first_name || '|' || last_name) as k, date_of_birth::text as dob from athletes`)
  return { rows: validateRows(grid, checked.headers, programs, existing), unknownHeaders: checked.unknownHeaders }
}

/** Imports valid, non-duplicate rows. Runs inside the caller's (RLS) transaction. */
export async function commitImport(q: Q, orgId: string, rows: ImportRow[]) {
  let created = 0
  for (const r of rows.filter((x) => !x.errors.length && !x.duplicate)) {
    let sportId: string | null = null
    if (r.sport) {
      const [sp] = await q<{ id: string }>(
        `insert into sports (organization_id, name) values ($1, $2)
         on conflict (organization_id, name) do update set name = excluded.name returning id`, [orgId, r.sport])
      sportId = sp.id
    }
    const [a] = await q<{ id: string }>(
      `insert into athletes (organization_id, first_name, last_name, date_of_birth, sport_id, position, school_team, status,
                             join_date, notes, current_program_id, current_level_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9::date, current_date),$10,$11,$12) returning id`,
      [orgId, r.first_name, r.last_name, r.dob ?? null, sportId, r.position ?? null, r.school_team ?? null, r.status,
       r.join_date ?? null, r.notes ?? null, r.program_id ?? null, r.level_id ?? null])
    await q(`insert into athlete_progress_events (organization_id, athlete_id, kind, title, occurred_at)
             values ($1, $2, 'milestone', 'Joined ' || (select name from organizations where id = $1), coalesce($3::date, current_date) + time '12:00')`,
      [orgId, a.id, r.join_date ?? null])
    await q('select sync_future_rosters($1)', [a.id])
    if (r.parent_name) {
      let gid = r.parent_email
        ? (await q<{ id: string }>('select id from guardians where lower(email) = $1 limit 1', [r.parent_email]))[0]?.id
        : undefined
      if (!gid) {
        gid = (await q<{ id: string }>('insert into guardians (organization_id, name, email, phone) values ($1,$2,$3,$4) returning id',
          [orgId, r.parent_name, r.parent_email ?? null, r.parent_phone ?? null]))[0].id
      }
      await q('insert into athlete_guardians (organization_id, athlete_id, guardian_id) values ($1,$2,$3) on conflict do nothing', [orgId, a.id, gid])
    }
    created++
  }
  return created
}
