sunymedicareparcelportal_v4.0.5

## Database Schema Cleanup

### Quick Start
1. **Backup tables before migration:**
   ```bash
   npm run backup-tables
   ```

2. **Review the audit report:**
   ```bash
   npm run schema-audit
   # Then read SCHEMA_AUDIT_REPORT.md
   ```

3. **Apply the migration:**
   ```bash
   npx supabase migration up
   ```

4. **If rollback needed:**
   ```bash
   npx supabase migration up --file rollback_archive_unused_tables.sql
   ```

### What Gets Archived
- `master_dummy` - Sync table with no application usage
- `missing_scans` - Unused table
- `parties` - Legacy table with no references
- `inactive_parties_view` - View depending on master_dummy

### Safety Features
- ✅ **Reversible**: Full rollback migration provided
- ✅ **Data preservation**: Tables moved to archive schema, not dropped
- ✅ **Backup script**: Automated backup before migration
- ✅ **Verification**: Built-in checks and logging

### Files Created
- `SCHEMA_AUDIT_REPORT.md` - Detailed analysis of table usage
- `scripts/backup_tables.sh` - Backup script for safety
- `supabase/migrations/archive_unused_tables.sql` - Main migration
- `supabase/migrations/rollback_archive_unused_tables.sql` - Rollback migration

## Database Schema Cleanup

### Quick Start
1. **Backup tables before migration:**
   ```bash
   npm run backup-tables
   ```

2. **Review the audit report:**
   ```bash
   npm run schema-audit
   # Then read SCHEMA_AUDIT_REPORT.md
   ```

3. **Apply the migration:**
   ```bash
   npx supabase migration up
   ```

4. **If rollback needed:**
   ```bash
   npx supabase migration up --file rollback_archive_unused_tables.sql
   ```

### What Gets Archived
- `master_dummy` - Sync table with no application usage
- `missing_scans` - Unused table
- `parties` - Legacy table with no references
- `inactive_parties_view` - View depending on master_dummy

### Safety Features
- ✅ **Reversible**: Full rollback migration provided
- ✅ **Data preservation**: Tables moved to archive schema, not dropped
- ✅ **Backup script**: Automated backup before migration
- ✅ **Verification**: Built-in checks and logging

### Files Created
- `SCHEMA_AUDIT_REPORT.md` - Detailed analysis of table usage
- `scripts/backup_tables.sh` - Backup script for safety
- `supabase/migrations/archive_unused_tables.sql` - Main migration
- `supabase/migrations/rollback_archive_unused_tables.sql` - Rollback migration
