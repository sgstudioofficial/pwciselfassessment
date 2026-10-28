import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, invokeEdge, supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'
import { getErrorMessage } from '../lib/errors'
import { readSessionId } from '../lib/session'
import { useToast } from './ToastContext'

type AuthContextValue = {
  session: Session | null
  profile: Profile | null
  loading: boolean
  configured: boolean
  signInAdmin: (email: string, password: string) => Promise<Profile>
  signInStudent: (username: string, password: string) => Promise<Profile>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<Profile | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const profileUserIdRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  // False until the current session has been offered to the database. The
  // poller waits for this so a page load cannot sign itself out before the
  // adoption call has finished.
  const sessionRegisteredRef = useRef(false)

  const loadProfile = useCallback(async (userId: string): Promise<Profile> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) throw error
    if (!data) {
      throw new Error(
        'Your profile could not be found. Ask your administrator to check your account.',
      )
    }
    if (!data.is_active) {
      await supabase.auth.signOut()
      throw new Error('This account is deactivated. Contact your administrator.')
    }

    if (mountedRef.current) {
      setProfile(data as Profile)
      profileUserIdRef.current = data.id
    }
    return data as Profile
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error && !/session|missing/i.test(error.message)) {
      // Local state is cleared regardless so the user is never trapped.
      console.warn('Sign out warning:', error.message)
    }
    setProfile(null)
    setSession(null)
    profileUserIdRef.current = null
  }, [])

  /**
   * Stores this browser's session id on the profile. `force` is true on an
   * explicit sign-in (take the account over) and false on page load (adopt only
   * if no session has been registered yet).
   */
  const registerSession = useCallback(
    async (accessToken: string | null | undefined, force: boolean) => {
      const sessionId = readSessionId(accessToken)
      if (!sessionId) return
      sessionRegisteredRef.current = false
      try {
        const { error } = await supabase.rpc('register_active_session', {
          p_session_id: sessionId,
          p_force: force,
        })
        if (error) console.warn('Could not register this session:', error.message)
      } finally {
        sessionRegisteredRef.current = true
      }
    },
    [],
  )

  const closeSupersededSession = useCallback(async () => {
    // Local scope only: the newer device owns the account and must keep its
    // tokens. Signing out globally would revoke the session that just won.
    await supabase.auth.signOut({ scope: 'local' })
    setProfile(null)
    setSession(null)
    profileUserIdRef.current = null
    toast.error(
      'Signed out',
      'This account signed in on another device, so this session was closed.',
    )
  }, [toast])

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    if (!data.session) {
      setProfile(null)
      profileUserIdRef.current = null
      return null
    }
    return loadProfile(data.session.user.id)
  }, [loadProfile])

  useEffect(() => {
    mountedRef.current = true

    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    const bootstrap = async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (!mountedRef.current) return
        // Adopt this session only when the account has none registered yet, so
        // a reload cannot take the account back from a newer sign-in.
        if (data.session) await registerSession(data.session.access_token, false)
        if (!mountedRef.current) return
        setSession(data.session)

        if (data.session) {
          try {
            await loadProfile(data.session.user.id)
          } catch (error) {
            if (mountedRef.current) {
              toast.error('Session ended', getErrorMessage(error))
              setProfile(null)
              profileUserIdRef.current = null
            }
          }
        }
      } catch (error) {
        if (mountedRef.current) {
          toast.error('Could not restore your session', getErrorMessage(error))
        }
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    }

    void bootstrap()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mountedRef.current) return
      setSession(nextSession)

      if (!nextSession || event === 'SIGNED_OUT') {
        setProfile(null)
        profileUserIdRef.current = null
        setLoading(false)
        return
      }

      // Never call Supabase synchronously inside this callback.
      if (
        (event === 'SIGNED_IN' || event === 'USER_UPDATED') &&
        nextSession.user.id !== profileUserIdRef.current
      ) {
        setTimeout(() => {
          void loadProfile(nextSession.user.id).catch((error: unknown) => {
            if (mountedRef.current) {
              toast.error('Could not load your profile', getErrorMessage(error))
            }
          })
        }, 0)
      }
    })

    return () => {
      mountedRef.current = false
      subscription.unsubscribe()
    }
  }, [loadProfile, registerSession, toast])

  const sessionId = useMemo(
    () => readSessionId(session?.access_token),
    [session?.access_token],
  )

  // Single-session enforcement. The newest sign-in owns the account; every
  // other browser notices within 20 s (or on focus) and signs itself out.
  useEffect(() => {
    if (!sessionId || !isSupabaseConfigured) return

    let cancelled = false
    let checking = false

    const check = async () => {
      if (cancelled || checking || !sessionRegisteredRef.current) return
      checking = true
      try {
        const { data, error } = await supabase.rpc('is_active_session', {
          p_session_id: sessionId,
        })
        if (cancelled || error) return
        if (data === false) {
          cancelled = true
          await closeSupersededSession()
        }
      } catch {
        // Transient failure: keep the session and retry on the next tick.
      } finally {
        checking = false
      }
    }

    const interval = window.setInterval(() => void check(), 20_000)
    const onFocus = () => void check()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [sessionId, closeSupersededSession])

  const signInAdmin = useCallback(
    async (email: string, password: string): Promise<Profile> => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (error || !data.session) {
        throw new Error(getErrorMessage(error ?? new Error('Sign in failed.')))
      }

      await registerSession(data.session.access_token, true)
      setSession(data.session)
      const nextProfile = await loadProfile(data.user.id)
      if (nextProfile.role !== 'admin') {
        await supabase.auth.signOut()
        setProfile(null)
        profileUserIdRef.current = null
        throw new Error('This account does not have administrator access.')
      }
      return nextProfile
    },
    [loadProfile, registerSession],
  )

  const signInStudent = useCallback(
    async (username: string, password: string): Promise<Profile> => {
      const data = await invokeEdge<{ session: Session }>('student-login', {
        username: username.trim().toLowerCase(),
        password,
      })
      if (!data?.session) {
        throw new Error('Incorrect username or password.')
      }

      const { error } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      })
      if (error) throw new Error(getErrorMessage(error))

      await registerSession(data.session.access_token, true)
      setSession(data.session)
      const nextProfile = await loadProfile(data.session.user.id)
      if (nextProfile.role !== 'student') {
        await supabase.auth.signOut()
        setProfile(null)
        profileUserIdRef.current = null
        throw new Error('This account is not a student account.')
      }
      return nextProfile
    },
    [loadProfile, registerSession],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      configured: isSupabaseConfigured,
      signInAdmin,
      signInStudent,
      signOut,
      refreshProfile,
    }),
    [
      session,
      profile,
      loading,
      signInAdmin,
      signInStudent,
      signOut,
      refreshProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return context
}
