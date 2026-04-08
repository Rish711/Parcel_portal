# Complete Parcel Portal Schema Migration

## Overview

This document describes the complete database schema for the Parcel Portal application. The migration file `COMPLETE_PARCEL_PORTAL_SCHEMA.sql` contains everything needed to set up a fully functional Parcel Portal database from scratch.

## Migration File Location

```
/supabase/migrations/COMPLETE_PARCEL_PORTAL_SCHEMA.sql
```

## What's Included

### 📊 Database Objects Summary

- **12 Tables** - All core and operational tables
- **80+ Database Objects** - Tables, indexes, triggers, functions, policies, views
- **8 Foreign Key Constraints** - Proper relationship management with CASCADE rules
- **50+ Performance Indexes** - Optimized for common query patterns
- **9 Triggers** - Auto-updating timestamps and data synchronization
- **12 Stored Functions** - Business logic and utility operations
- **24 RLS Policies** - Row Level Security for data protection
- **2 Analytics Views** - Pre-built reporting views
- **3 Sample Courier Agencies** - Seed data for testing

## Database Architecture

### Core Tables

#### 1. party_information
Master table for customer/party data
- **Primary Key**: party_code (text)
- **Columns**: party_name, address, phone_number, timestamps
- **Features**: Auto-syncs to master_dummy via trigger

#### 2. party_list
Daily parcel entries for each party
- **Primary Key**: id (uuid)
- **Foreign Keys**: party_code → party_information, courier_agency_id → courier_agency_list
- **Columns**: date, bill_numbers (array), boxes, label_generated, phone_number
- **Features**: Auto-syncs to analysis_table, resets label_generated on data change

#### 3. courier_agency_list
Courier service provider information
- **Primary Key**: id (uuid)
- **Unique**: agency_number
- **Columns**: agency_name, timestamps
- **Features**: Auto-updating updated_at timestamp

#### 4. courier_rates
Rate configuration per courier agency
- **Primary Key**: id (uuid)
- **Unique**: courier_agency_id
- **Foreign Keys**: courier_agency_id → courier_agency_list
- **Columns**: rate_per_box (default 10.00)
- **Features**: One rate per courier, auto-updating timestamps

#### 5. courier_bills
Generated billing records
- **Primary Key**: id (uuid)
- **Foreign Keys**: transporter_id → courier_agency_list
- **Columns**: from_date, to_date, number_of_boxes, per_box_rate, total_cost
- **Constraints**: All numeric values must be > 0
- **Features**: Auto-updating timestamps, date range indexing

#### 6. label_prints
Generated labels with QR codes
- **Primary Key**: id (uuid)
- **Unique**: qr_code
- **Foreign Keys**: party_list_id → party_list, courier_agency_id → courier_agency_list
- **Columns**: party_name, party_code, address, bill_numbers (array), boxes, transport, label_type, status, scanned_at, scanned_count, phone_number
- **Constraints**: label_type IN ('courier', 'byhand'), status IN ('missing', 'scanned')
- **Features**: Comprehensive indexing for scanning operations

#### 7. scan_tally
Individual scan records
- **Primary Key**: id (uuid)
- **Foreign Keys**: label_print_id → label_prints
- **Columns**: qr_code, status, scanned_at
- **Features**: Blocks scanning of flagged parties via trigger

#### 8. analysis_table
Aggregated data for reporting
- **Primary Key**: id (uuid)
- **Unique**: Combination of (date, party_code, courier_agency_id)
- **Foreign Keys**: party_code → party_information, courier_agency_id → courier_agency_list
- **Columns**: date, bill_numbers (array), boxes
- **Features**: Auto-synchronized from party_list

#### 9. master_dummy
Synchronized backup of party_information
- **Primary Key**: party_code
- **Columns**: party_name, address, timestamps
- **Features**: Auto-synced via triggers, provides recovery capability

#### 10. missing_scans
Archive of cleared missing scans
- **Primary Key**: id (uuid)
- **Columns**: qr_code, party_name, address, transport, original_scan_time, cleared_at, reason
- **Features**: Audit trail for resolved missing scans

#### 11. flagged_parties
Parties requiring special handling
- **Primary Key**: party_code
- **Columns**: party_name, address, flagged_at
- **Features**: Blocks scanning until unflagged, prevents multiple bills per box issues

#### 12. migration_log
Migration tracking and rollback
- **Primary Key**: id (serial)
- **Columns**: migration_name, applied_at, description, archived_tables, rollback_info (jsonb)
- **Features**: Tracks all migrations, supports rollback operations

## Key Features

### 🔒 Data Integrity

1. **Foreign Key Constraints**
   - All relationships properly defined
   - CASCADE deletes where appropriate
   - SET NULL for optional relationships

2. **Unique Constraints**
   - agency_number in courier_agency_list
   - qr_code in label_prints
   - courier_agency_id in courier_rates
   - Composite unique on analysis_table (date, party_code, courier_agency_id)

3. **Check Constraints**
   - label_type must be 'courier' or 'byhand'
   - status must be 'missing' or 'scanned'
   - All numeric values in courier_bills must be > 0

### ⚡ Performance Optimization

**50+ Strategically Placed Indexes:**

- **Primary Keys**: All tables
- **Foreign Keys**: All relationships indexed
- **Date Fields**: Descending indexes for time-based queries
- **Status Fields**: For filtering operations
- **QR Codes**: For fast lookups during scanning
- **Composite Indexes**: For complex query patterns

### 🔄 Automatic Data Management

**9 Active Triggers:**

1. **update_courier_agency_list_updated_at** - Auto-update timestamps
2. **update_courier_rates_updated_at** - Auto-update timestamps
3. **update_courier_bills_updated_at** - Auto-update timestamps
4. **update_label_prints_updated_at** - Auto-update timestamps
5. **update_scan_tally_updated_at** - Auto-update timestamps
6. **trigger_reset_label_generated** - Reset flag when data changes
7. **sync_party_to_master** - Sync party_information to master_dummy
8. **sync_party_list_to_analysis** - Sync party_list to analysis_table
9. **trg_block_flagged_scan** - Prevent scanning flagged parties

### 🛡️ Security (RLS)

**Row Level Security enabled on all tables with:**
- Policies for anonymous users (anon)
- Policies for authenticated users
- Full CRUD operations allowed (appropriate for internal business app)

### 📊 Built-in Analytics

**Two Pre-built Views:**

1. **daily_parcel_summary**
   - Daily summary by courier
   - Total entries, boxes, labels generated/pending
   - Aggregated statistics

2. **scan_statistics**
   - Scanning completion rates
   - Total labels vs scanned labels
   - Percentage calculations
   - Time-series data

### 🔧 Stored Procedures

**12 Functions Available:**

- `update_updated_at_column()` - Generic timestamp updater
- `update_courier_rates_updated_at()` - Rate-specific timestamp
- `update_courier_bills_updated_at()` - Bill-specific timestamp
- `update_label_prints_updated_at()` - Label-specific timestamp
- `update_scan_tally_updated_at()` - Scan-specific timestamp
- `reset_label_generated_on_update()` - Smart flag management
- `sync_to_master_dummy()` - Data synchronization
- `sync_to_analysis_table()` - Analytics synchronization
- `block_flagged_party_scan()` - Business rule enforcement
- `create_flagged_parties_table()` - Compatibility function

## Execution Instructions

### Running the Migration

The migration is **idempotent** and can be safely run multiple times:

```bash
# Using Supabase CLI
supabase db reset

# Or apply directly
psql -h your-host -U your-user -d your-db -f supabase/migrations/COMPLETE_PARCEL_PORTAL_SCHEMA.sql
```

### Verification

After running the migration, verify with:

```sql
-- Check all tables exist
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- Check indexes
SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename;

-- Check triggers
SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE event_object_schema = 'public';

-- Check RLS policies
SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';

-- Verify migration log
SELECT * FROM migration_log ORDER BY applied_at DESC;
```

## Seed Data

The migration includes sample data:

### Courier Agencies
1. **Express Courier Service** (agency_number: 001, rate: 10.00)
2. **Fast Track Logistics** (agency_number: 002, rate: 12.50)
3. **Swift Delivery Network** (agency_number: 003, rate: 15.00)

## Data Flow

### Creating a Parcel Entry

```
1. Add party to party_information (if new)
   ↓ (trigger: sync_to_master_dummy)
2. Party synced to master_dummy automatically

3. Create entry in party_list
   ↓ (trigger: sync_party_list_to_analysis)
4. Entry synced to analysis_table automatically

5. Generate label via application
   ↓ (creates record in label_prints)
6. Label ready for printing

7. Scan QR code
   ↓ (creates record in scan_tally with trigger check)
8. If party flagged → ERROR
   If not flagged → Scan recorded
   ↓
9. Updates label_prints.status and scanned_count
```

### Updating a Party List Entry

```
1. Update bill_numbers, boxes, or courier_agency_id in party_list
   ↓ (trigger: reset_label_generated_on_update)
2. label_generated flag reset to false
   ↓ (trigger: sync_party_list_to_analysis)
3. analysis_table updated automatically
```

## Business Rules Enforced

1. **Unique QR Codes**: Each label has a unique QR code
2. **Flagged Parties**: Cannot scan parcels for flagged parties
3. **Label Regeneration**: Labels must be regenerated when key data changes
4. **Data Synchronization**: Master data automatically synced for backup
5. **Audit Trail**: All operations tracked with timestamps
6. **Referential Integrity**: Cascade deletes maintain consistency

## Maintenance

### Regular Tasks

```sql
-- Update statistics for query planner
ANALYZE;

-- Check index usage
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan;

-- Monitor table sizes
SELECT
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Backup Recommendations

1. Regular full database backups
2. Export migration_log for recovery tracking
3. Archive old scan_tally records periodically
4. Maintain master_dummy as secondary backup

## Troubleshooting

### Common Issues

1. **Duplicate QR Code Error**
   - Check label_prints for existing QR code
   - Verify QR generation logic

2. **Flagged Party Scan Blocked**
   - Check flagged_parties table
   - Unflag party if resolved
   - Error message: "Multiple bills must be added in the same box"

3. **Label Not Generating**
   - Verify label_generated flag in party_list
   - Check if data changed (triggers reset)

4. **Foreign Key Violation**
   - Ensure referenced records exist
   - Check CASCADE rules for delete operations

## Performance Tuning

### Query Optimization Tips

1. Use indexed columns in WHERE clauses
2. Leverage composite indexes for complex queries
3. Use views for common reporting patterns
4. Analyze slow queries with EXPLAIN ANALYZE

### Index Maintenance

```sql
-- Reindex if needed
REINDEX TABLE party_list;
REINDEX TABLE label_prints;
REINDEX TABLE scan_tally;
```

## Schema Evolution

To extend the schema:

1. Create new migration file with timestamp prefix
2. Use IF NOT EXISTS for all CREATE statements
3. Document changes in migration_log
4. Test on development environment first
5. Run ANALYZE after schema changes

## Support and Documentation

- **Schema Version**: 1.0.0 (Complete)
- **Migration Date**: 2025-11-08
- **Total Database Objects**: 80+
- **Lines of SQL**: 1022

## License

This schema is part of the Parcel Portal project. All rights reserved.

---

**Generated**: 2025-11-08
**Status**: Production Ready
**Tested**: ✅ All objects created successfully
