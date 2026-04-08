# New Supabase Database Setup

Use this when you want to create one more fresh database for this Parcel Portal app.

Important: the migration is for a complete app database, not only the first few tables visible in Supabase Table Editor. Supabase lists tables alphabetically, so if your screen shows `analysis_table`, `bill_numbers_registry`, `box_qr_codes`, `courier_agency_list`, and `courier_bills`, that matches the beginning of this schema. The rest of the app also needs tables like `label_prints`, `party_list`, `party_information`, `scan_tally`, `users`, and the legacy `parties` table.

To check your existing database table list, run this in Supabase SQL Editor:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
order by table_name;
```

## 1. Create New Supabase Project

1. Open Supabase.
2. Create a new project.
3. Wait until the database is ready.

## 2. Run Full Schema Script

Open the new project's SQL Editor and run:

```text
supabase/migrations/20260408123000_fresh_database_full_schema.sql
```

If you want to restore the trigger definitions separately, run this after the full schema:

```text
supabase/migrations/20260408124500_restore_original_public_triggers.sql
```

For an existing database that was already created before the Developer Notice feature, also run:

```text
supabase/migrations/20260408130000_add_app_notices.sql
```

For an existing database that was already created before Company Settings, also run:

```text
supabase/migrations/20260408150000_add_company_settings.sql
```

Do not manually run trigger SQL for `pgsodium`, `realtime`, or `storage`. Those are Supabase system triggers and are created automatically by Supabase.

This creates the complete working schema for the current app, including:

- `party_information`
- `parties`
- `party_list`
- `courier_agency_list`
- `courier_rates`
- `courier_bills`
- `label_prints`
- `box_qr_codes`
- `scan_tally`
- `analysis_table`
- `master_dummy`
- `missing_scans`
- `flagged_parties`
- `bill_numbers_registry`
- `users`
- `app_notices`
- `company_settings`
- views such as `duplicate_bills_check` and `inactive_parties_view`
- triggers, indexes, RLS policies, and RPC functions

## 3. Update `.env`

After the new Supabase project is ready, replace these values in `.env`:

```env
VITE_SUPABASE_URL=https://YOUR_NEW_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_NEW_ANON_KEY
```

You can find both values in Supabase project settings under API.

## 4. Default Login Users

The script creates these initial app users:

```text
yogiraj / 6899
suny / 2799
rish / 6899
```

You can add/change users from the app Settings tab.
