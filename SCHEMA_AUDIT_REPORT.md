# Supabase Schema Cleanup - Audit Report

## Executive Summary
This report analyzes the current Supabase schema to identify unused tables and provides a safe migration plan to archive them.

## 1. Usage Audit Results

### Table Reference Analysis

#### ✅ **ACTIVE TABLES** (Referenced in code)

**analysis_table**
- **References found:**
  - `src/components/HistoryTab.tsx:165` - DELETE operation in handleDelete function
  - Database schema shows foreign key relationships with party_list and courier_agency_list
  - Has triggers: `sync_party_list_to_analysis`
- **Status:** KEEP - Used for historical data tracking

**courier_agency_list**
- **References found:**
  - `src/components/PartyListTab.tsx:89` - SELECT in fetchCourierAgencies
  - `src/components/HistoryTab.tsx:134` - SELECT in fetchCourierAgencies  
  - `src/components/CourierBillTab.tsx:85` - SELECT in fetchCourierAgencies
  - `src/components/ScanTallyTab.tsx:108` - SELECT in fetchCourierAgencies
  - Multiple JOIN operations across components
- **Status:** KEEP - Core table for courier management

**courier_bills**
- **References found:**
  - `src/components/CourierBillTab.tsx:98` - SELECT in fetchCourierBills
  - `src/components/CourierBillTab.tsx:280` - INSERT in handleSubmit
  - `src/components/CourierBillTab.tsx:295` - UPDATE in handleSubmit
  - `src/components/CourierBillTab.tsx:330` - DELETE in handleDelete
- **Status:** KEEP - Active billing functionality

**courier_rates**
- **References found:**
  - `src/components/CourierBillTab.tsx:115` - SELECT in fetchCourierRates
  - Used for pricing calculations in courier billing
- **Status:** KEEP - Required for billing calculations

**label_prints**
- **References found:**
  - `src/lib/labelPersistence.ts:89` - Multiple operations (SELECT, INSERT, UPDATE, DELETE)
  - `src/components/LabelPrintTab.tsx:85` - getTodaysLabelPrints function
  - `src/components/ScanTallyTab.tsx:85` - getTodaysScanTally function
- **Status:** KEEP - Core label printing functionality

**party_information**
- **References found:**
  - `src/components/PartyListTab.tsx:200` - SELECT in handlePartyCodeChange
  - `src/components/PartyLedgerTab.tsx:89` - SELECT in searchParty
  - `src/components/HistoryTab.tsx` - JOIN operations
  - Referenced in multiple foreign key relationships
- **Status:** KEEP - Master party data

**party_list**
- **References found:**
  - `src/components/PartyListTab.tsx:124` - SELECT in fetchTodayEntries
  - `src/components/PartyListTab.tsx:245` - INSERT/UPDATE in handleSubmit
  - `src/components/HistoryTab.tsx:180` - SELECT in fetchHistory
  - `src/components/LabelPrintTab.tsx:85` - SELECT for label generation
  - `src/components/PartyLedgerTab.tsx:115` - SELECT in loadParty
- **Status:** KEEP - Core transaction data

**scan_tally**
- **References found:**
  - `src/lib/labelPersistence.ts:200` - Referenced in markBarcodeAsScanned
  - Database schema shows foreign key to label_prints
- **Status:** KEEP - Scanning functionality

#### ❌ **UNUSED TABLES** (No references found)

**master_dummy**
- **References found:** None in application code
- **Database dependencies:** 
  - Referenced in `inactive_parties_view` 
  - Has trigger `sync_party_to_master` from party_information
- **Status:** DEPRECATE - Appears to be a sync/cache table not used by application

**missing_scans**
- **References found:** None in application code
- **Database dependencies:** None (standalone table)
- **Status:** DEPRECATE - No application usage found

**parties**
- **References found:** None in application code
- **Database dependencies:** None (no RLS policies, no foreign keys)
- **Status:** DEPRECATE - Appears to be unused/legacy

#### 📊 **VIEWS**

**inactive_parties_view**
- **References found:** None in application code
- **Dependencies:** Uses master_dummy and analysis_table
- **Status:** DEPRECATE - No application usage, depends on deprecated master_dummy

## 2. Decision Matrix

| Table | Status | Reason | Dependencies to Handle |
|-------|--------|--------|----------------------|
| analysis_table | KEEP | Used in HistoryTab for data cleanup | None |
| courier_agency_list | KEEP | Core courier management | None |
| courier_bills | KEEP | Active billing functionality | None |
| courier_rates | KEEP | Required for billing calculations | None |
| label_prints | KEEP | Core label printing | None |
| party_information | KEEP | Master party data | None |
| party_list | KEEP | Core transaction data | None |
| scan_tally | KEEP | Scanning functionality | None |
| **master_dummy** | **DEPRECATE** | No app usage, sync table | Drop trigger, view |
| **missing_scans** | **DEPRECATE** | No app usage | None |
| **parties** | **DEPRECATE** | No app usage, legacy | None |
| **inactive_parties_view** | **DEPRECATE** | No app usage | None |

## 3. Impact Analysis

### Tables to Archive:
- `master_dummy` (3,847 bytes estimated)
- `missing_scans` (minimal data)
- `parties` (minimal data)

### Dependencies to Remove:
- `inactive_parties_view` (depends on master_dummy)
- `sync_party_to_master` trigger (on party_information)

### Risk Assessment: **LOW**
- No foreign key constraints to archived tables
- No application code references
- All dependencies can be safely removed

## 4. Backup Strategy

### Pre-migration Backup:
```bash
# Create backup directory
mkdir -p backups/$(date +%Y%m%d)

# Backup each table with data
pg_dump --data-only --column-inserts --table=public.master_dummy $DATABASE_URL > backups/$(date +%Y%m%d)/master_dummy.sql
pg_dump --data-only --column-inserts --table=public.missing_scans $DATABASE_URL > backups/$(date +%Y%m%d)/missing_scans.sql
pg_dump --data-only --column-inserts --table=public.parties $DATABASE_URL > backups/$(date +%Y%m%d)/parties.sql
```

### Restore Instructions:
```bash
# To restore a single table:
psql $DATABASE_URL < backups/YYYYMMDD/table_name.sql
```

## 5. Migration Plan

### Phase 1: Archive (Reversible)
1. Create `archive` schema
2. Move deprecated tables to archive with date suffix
3. Drop dependent views and triggers
4. Verify application functionality

### Phase 2: Cleanup (After verification period)
1. Drop archived tables permanently (optional, after 30+ days)

## 6. Verification Steps

### Pre-migration:
- [ ] Run full application test suite
- [ ] Verify all core workflows (Party List, Label Print, Scan Tally, History)
- [ ] Create data backups

### Post-migration:
- [ ] Verify no "relation does not exist" errors
- [ ] Test all application features
- [ ] Confirm rollback migration works

## 7. Rollback Plan

If issues arise, the rollback migration will:
1. Move tables back from `archive` to `public` schema
2. Restore original table names
3. Recreate dropped triggers and views
4. Verify data integrity

## Conclusion

This migration will safely archive 3 unused tables and 1 view, reducing schema complexity while maintaining full reversibility. The risk is minimal as no active application code references these objects.