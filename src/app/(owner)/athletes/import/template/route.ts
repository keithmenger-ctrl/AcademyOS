import { requireAdmin } from '@/lib/auth'
import { TEMPLATE_HEADERS } from '@/lib/import/athletes'

// Downloadable CSV template with one example row; sport, position, school/team, program and level are optional and left blank.
export async function GET() {
  await requireAdmin()
  const example = ['Jordan', 'Rivera', '2011-04-18', '', '', '', 'active', '', '', '', 'Alex Rivera', 'alex.rivera@example.com', '555-0100', '']
  const csv = [TEMPLATE_HEADERS, example].map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n'
  return new Response(csv, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="athletes-template.csv"' },
  })
}
