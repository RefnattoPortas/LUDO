import { createClient } from '@supabase/supabase-js';

// New Project: https://supabase.com/dashboard/project/ebujbtckuqiidxdnjpgl
const SUPABASE_URL = 'https://ebujbtckuqiidxdnjpgl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ZgG1kV-reMXnCClN6eW1bw_Wp93APF4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: false,   // Prevents localStorage lock conflicts between tabs
        autoRefreshToken: false,
        detectSessionInUrl: false,
    }
});
