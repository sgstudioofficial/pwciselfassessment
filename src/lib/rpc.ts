import { supabase } from './supabase'

export async function callRpc<T>(
  functionName: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(functionName, args ?? {})
  if (error) throw error
  return data as T
}
