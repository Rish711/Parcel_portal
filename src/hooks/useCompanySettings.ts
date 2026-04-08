import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface CompanySettings {
  company_name: string;
  parcel_dept_phone: string;
  dept_head_phones: string;
  address: string;
  email: string;
}

const FALLBACK: CompanySettings = {
  company_name: 'Suny Medicare LLP',
  parcel_dept_phone: '7028502799',
  dept_head_phones: '8600519999, 7083169357',
  address: 'Kolhapur, Maharashtra',
  email: 'sunymedicarellp@gmail.com',
};

export function useCompanySettings() {
  const [settings, setSettings] = useState<CompanySettings>(FALLBACK);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(() => {
    setLoading(true);
    supabase
      .from('company_settings')
      .select('company_name, parcel_dept_phone, dept_head_phones, address, email')
      .eq('id', 1)
      .single()
      .then(({ data, error }) => {
        if (!error && data) setSettings(data as CompanySettings);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { settings, loading, refresh: fetch };
}
