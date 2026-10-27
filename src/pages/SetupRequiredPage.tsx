import { ArrowRight, Database, KeyRound, Terminal } from 'lucide-react'
import { Brand } from '../components/layout/Brand'

const steps = [
  {
    icon: Terminal,
    title: '1. Configure the frontend',
    body: 'Copy .env.example to .env.local and add your Supabase project URL and anon key. Only public keys belong in the browser.',
    code: 'VITE_SUPABASE_URL=https://<project-ref>.supabase.co\nVITE_SUPABASE_ANON_KEY=<anon-key>',
  },
  {
    icon: Database,
    title: '2. Apply the database migrations',
    body: 'Run the SQL migrations in supabase/migrations in order, then deploy the Edge Functions. The README contains the full procedure.',
    code: 'supabase link --project-ref <project-ref>\nsupabase db push\nsupabase functions deploy student-login --no-verify-jwt\nsupabase functions deploy admin-students',
  },
  {
    icon: KeyRound,
    title: '3. Provision the first administrator',
    body: 'Use the server-side script with your service-role key. Never place the service-role key in the frontend or in a VITE_ variable.',
    code: 'npm run create-admin -- admin@company.com "StrongPass123!" "Jane Admin"',
  },
]

export function SetupRequiredPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
        <Brand />
        <div className="mt-10">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">
            Configuration required
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            Connect PWCI Self Assessment Tool to Supabase
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
            The application is running, but no Supabase project is configured.
            Add your public project credentials, apply the migrations and create
            the first administrator.
          </p>
        </div>

        <div className="mt-9 space-y-4">
          {steps.map((step) => (
            <div
              key={step.title}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft"
            >
              <div className="flex items-start gap-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <step.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-slate-900">
                    {step.title}
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    {step.body}
                  </p>
                  <pre className="mt-3 overflow-x-auto rounded-lg bg-ink-950 p-3 text-[11px] leading-5 text-slate-300">
                    <code>{step.code}</code>
                  </pre>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <ArrowRight className="h-4 w-4 shrink-0" />
          Restart the development server after changing environment variables.
          Full setup, security and deployment notes are in README.md.
        </div>
      </div>
    </div>
  )
}
