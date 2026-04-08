import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 5000
};

const retryWithBackoff = async (fn: () => Promise<any>, retryCount = 0): Promise<any> => {
  try {
    return await fn();
  } catch (error) {
    if (retryCount >= RETRY_CONFIG.maxRetries) {
      throw error;
    }
    
    const delay = Math.min(
      RETRY_CONFIG.baseDelay * Math.pow(2, retryCount),
      RETRY_CONFIG.maxDelay
    );
    
    console.log(`Retry attempt ${retryCount + 1} after ${delay}ms`);
    await new Promise(resolve => setTimeout(resolve, delay));
    return retryWithBackoff(fn, retryCount + 1);
  }
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  },
  realtime: {
    params: {
      eventsPerSecond: 2
    }
  }
});

// Connection test function
export const testSupabaseConnection = async (): Promise<boolean> => {
  try {
    const { data, error } = await supabase
      .from('party_information')
      .select('count')
      .limit(1);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Supabase connection test failed:', error);
    return false;
  }
};

export const handleSupabaseError = (error: any): string => {
  if (error.code === '23505') {
    return 'A record with this information already exists.';
  }

  if (error.code === 'PGRST116') {
    return 'Record not found. It may have been deleted or does not exist.';
  }

  if (error.message?.includes('more than one row')) {
    return 'Update failed: Multiple records matched. This should not happen - please contact support.';
  }

  if (error.message?.includes('Box count must be between')) {
    return error.message;
  }

  if (error.message?.includes('violates unique constraint')) {
    return 'Cannot update: This would create a duplicate record.';
  }

  if (error.message?.includes('ERR_NETWORK') ||
      error.message?.includes('520')) {
    return 'Authentication error. Please refresh the page and try again.';
  }

  if (error.message?.includes('timeout')) {
    return 'The request timed out. Please try again.';
  }

  if (error.message?.includes('520') || error.code === '520') {
    return 'Server temporarily unavailable (Error 520). Please try again in a few moments.';
  }

  return error.message || 'An unexpected error occurred. Please try again.';
};