import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const PASSWORD = 'eacsc_1999_CEA'

const ROLE_ACCOUNTS = [
  {
    email: 'author@eacsc.example',
    full_name: 'Marco Reyes',
    council_position: 'Committee Head (Author)',
    functional_roles: ['author'],
    is_active: true,
    assign_public_role: 'author',
    assign_restricted: false,
  },
  {
    email: 'secretary@eacsc.example',
    full_name: 'Roxan Mariz Icaro',
    council_position: 'Executive Secretary (Primary Custodian)',
    functional_roles: ['custodian', 'author'],
    is_active: true,
    assign_public_role: 'custodian',
    assign_restricted: true,
  },
  {
    email: 'reviewer@eacsc.example',
    full_name: 'Alyssa Tan',
    council_position: 'VP for Internal Affairs (Reviewer)',
    functional_roles: ['reviewer'],
    is_active: true,
    assign_public_role: 'reviewer',
    assign_restricted: true,
  },
  {
    email: 'president@eacsc.example',
    full_name: 'Rafael Santos',
    council_position: 'EA-CSC President (Approver)',
    functional_roles: ['approver', 'reviewer'],
    is_active: true,
    assign_public_role: 'approver',
    assign_restricted: true,
  },
  {
    email: 'pio@eacsc.example',
    full_name: 'Camille Cruz',
    council_position: 'Public Information Officer (Publisher)',
    functional_roles: ['publisher'],
    is_active: true,
    assign_public_role: 'publisher',
    assign_restricted: true,
  },
  {
    email: 'admin@eacsc.example',
    full_name: 'Daniel Lim',
    council_position: 'Technical & Access Administrator',
    functional_roles: ['technical_admin', 'custodian'],
    is_active: true,
    assign_public_role: 'custodian',
    assign_restricted: true,
  },
  {
    email: 'observer@eacsc.example',
    full_name: 'Student Observer (Unassigned)',
    council_position: 'Non-Officer Student Observer',
    functional_roles: [],
    is_active: true,
    assign_public_role: null,
    assign_restricted: false,
  },
]

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_BACKUP_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_BACKUP_KEY')
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const client = new pg.Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  // 1. Deactivate legacy batch*/r3* test users in app_users (preserving audit FKs)
  await client.query(`
    UPDATE public.app_users
    SET is_active = false,
        functional_roles = '{}'::text[],
        updated_at = now()
    WHERE email LIKE 'batch%@example.invalid'
       OR email LIKE 'r3-%@example.invalid';
  `)

  // 2. Fetch existing auth users
  const { data: listData, error: listErr } = await sb.auth.admin.listUsers({
    perPage: 200,
  })
  if (listErr) throw listErr
  const existingByEmail = new Map(
    listData.users.map((u) => [String(u.email).toLowerCase(), u]),
  )

  const createdOrUpdated = []

  for (const acct of ROLE_ACCOUNTS) {
    let userId
    const existing = existingByEmail.get(acct.email.toLowerCase())
    if (existing) {
      const { data: updated, error: updErr } =
        await sb.auth.admin.updateUserById(existing.id, {
          password: PASSWORD,
          email_confirm: true,
          user_metadata: { full_name: acct.full_name },
        })
      if (updErr) throw updErr
      userId = updated.user.id
    } else {
      const { data: created, error: crErr } = await sb.auth.admin.createUser({
        email: acct.email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: acct.full_name },
      })
      if (crErr) throw crErr
      userId = created.user.id
    }

    await client.query(
      `
      INSERT INTO public.app_users (
        user_id, email, full_name, council_position, functional_roles, is_active
      ) VALUES ($1, $2, $3, $4, $5::text[], $6)
      ON CONFLICT (user_id) DO UPDATE
      SET email = EXCLUDED.email,
          full_name = EXCLUDED.full_name,
          council_position = EXCLUDED.council_position,
          functional_roles = EXCLUDED.functional_roles,
          is_active = EXCLUDED.is_active,
          updated_at = now();
      `,
      [
        userId,
        acct.email,
        acct.full_name,
        acct.council_position,
        acct.functional_roles,
        acct.is_active,
      ],
    )

    createdOrUpdated.push({ ...acct, userId })
  }

  const adminUser = createdOrUpdated.find(
    (u) => u.email === 'admin@eacsc.example',
  )
  const assignerId = adminUser.userId

  // 3. Ensure sample record assignments exist for active officer accounts
  const { rows: sampleRecords } = await client.query(`
    SELECT record_id
    FROM public.master_records
    WHERE record_id IN ('EACSC-2099-BT-9228', 'EACSC-2099-BR-1230')
  `)

  for (const acct of createdOrUpdated) {
    if (!acct.assign_public_role) continue
    for (const rec of sampleRecords) {
      if (rec.record_id === 'EACSC-2099-BR-1230' && !acct.assign_restricted) {
        continue
      }
      await client.query(
        `
        INSERT INTO public.record_assignments (
          record_id, user_id, assignment_function, is_active, allow_restricted, assigned_by
        ) VALUES ($1, $2, $3, true, $4, $5)
        ON CONFLICT (record_id, user_id, assignment_function) DO UPDATE
        SET is_active = true,
            allow_restricted = EXCLUDED.allow_restricted,
            updated_at = now();
        `,
        [
          rec.record_id,
          acct.userId,
          acct.assign_public_role,
          acct.assign_restricted,
          assignerId,
        ],
      )
    }
  }

  await client.end()
  console.log(
    'SEEDED ROLE ACCOUNTS:',
    JSON.stringify(
      createdOrUpdated.map((u) => ({
        email: u.email,
        full_name: u.full_name,
        council_position: u.council_position,
        roles: u.functional_roles,
      })),
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
