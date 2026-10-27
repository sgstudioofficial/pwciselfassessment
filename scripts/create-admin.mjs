#!/usr/bin/env node
/**
 * Securely provision the first administrator.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npm run create-admin -- admin@company.com "A-strong-password-1" "Jane Admin"
 *
 * Or place SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local /
 * .env (never committed, never VITE_ prefixed) and run the same command.
 *
 * This runs only on a trusted machine. It never prints the service-role key.
 * If the email already exists, that account is promoted instead of recreated.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

function loadEnvFile(filename) {
  const file = path.resolve(process.cwd(), filename)
  if (!fs.existsSync(file)) return
  const content = fs.readFileSync(file, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index === -1) continue
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvFile('.env.local')
loadEnvFile('.env')

const [emailArg, passwordArg, ...nameParts] = process.argv.slice(2)
const email = (emailArg ?? '').trim().toLowerCase()
const password = passwordArg ?? ''
const fullName = nameParts.join(' ').trim() || 'Administrator'

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

if (!supabaseUrl || !serviceRoleKey) {
  fail(
    'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment or .env.local.',
  )
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  fail('Pass a valid administrator email as the first argument.')
}
if (password.length < 10 || password.length > 72) {
  fail('Password must be 10–72 characters.')
}
if (!/^https?:\/\//.test(supabaseUrl)) {
  fail('SUPABASE_URL must be an http(s) URL.')
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function findAuthUser(emailAddress) {
  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (error) fail(`Could not list auth users: ${error.message}`)
    const match = data.users.find(
      (user) => user.email?.toLowerCase() === emailAddress,
    )
    if (match) return match
    if (data.users.length < 1000) return null
    page += 1
  }
}

async function main() {
  console.log(`Provisioning administrator ${email}…`)

  const { data: existingProfile, error: profileLookupError } = await admin
    .from('profiles')
    .select('id, role')
    .ilike('email', email)
    .maybeSingle()

  if (profileLookupError) {
    fail(`Could not look up profiles: ${profileLookupError.message}`)
  }

  let userId = existingProfile?.id ?? null

  if (!userId) {
    const authUser = await findAuthUser(email)
    if (authUser) {
      userId = authUser.id
      console.log('Found an existing auth user; promoting it.')
    }
  }

  if (!userId) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (createError || !created.user) {
      fail(`Could not create the admin account: ${createError?.message ?? 'unknown error'}`)
    }
    userId = created.user.id
    console.log('Created a new auth account.')
  } else {
    // Keep the supplied password authoritative if the account already existed.
    const { error: passwordError } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    })
    if (passwordError) {
      fail(`Could not set the administrator password: ${passwordError.message}`)
    }
  }

  const { error: promoteError } = await admin
    .from('profiles')
    .update({
      role: 'admin',
      full_name: fullName,
      email,
      is_active: true,
      must_change_password: true,
      username: null,
    })
    .eq('id', userId)

  if (promoteError) {
    fail(`Could not promote the profile: ${promoteError.message}`)
  }

  console.log('\n✔ Administrator ready.')
  console.log(`  Email: ${email}`)
  console.log('  Sign in at /login → Admin, then set a new password when prompted.')
  console.log('  The password is never printed. Keep it in your password manager.\n')
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
