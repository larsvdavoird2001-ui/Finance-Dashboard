import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const supabaseEnabled = !!(supabaseUrl && supabaseAnonKey)

export const supabase: SupabaseClient = supabaseEnabled
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null as unknown as SupabaseClient // wordt niet gebruikt als supabaseEnabled=false
