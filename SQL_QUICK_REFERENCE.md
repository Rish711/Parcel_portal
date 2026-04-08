# Parcel Portal SQL Quick Reference

## Common Queries

### Party Management

```sql
-- Get all parties with parcel counts
SELECT
  pi.party_code,
  pi.party_name,
  pi.address,
  COUNT(pl.id) AS total_parcels,
  SUM(pl.boxes) AS total_boxes
FROM party_information pi
LEFT JOIN party_list pl ON pi.party_code = pl.party_code
GROUP BY pi.party_code, pi.party_name, pi.address
ORDER BY total_parcels DESC;

-- Find parties with pending labels
SELECT DISTINCT
  pi.party_code,
  pi.party_name,
  COUNT(pl.id) AS pending_labels
FROM party_information pi
JOIN party_list pl ON pi.party_code = pl.party_code
WHERE pl.label_generated = false
GROUP BY pi.party_code, pi.party_name
HAVING COUNT(pl.id) > 0;

-- Search parties by name or code
SELECT * FROM party_information
WHERE party_name ILIKE '%search_term%'
   OR party_code ILIKE '%search_term%'
ORDER BY party_name;
```

### Courier Operations

```sql
-- Get courier rates
SELECT
  ca.agency_name,
  ca.agency_number,
  COALESCE(cr.rate_per_box, 0) AS rate_per_box
FROM courier_agency_list ca
LEFT JOIN courier_rates cr ON ca.id = cr.courier_agency_id
ORDER BY ca.agency_name;

-- Daily parcel count by courier
SELECT
  DATE(pl.date) AS parcel_date,
  ca.agency_name,
  COUNT(pl.id) AS entry_count,
  SUM(pl.boxes) AS total_boxes
FROM party_list pl
JOIN courier_agency_list ca ON pl.courier_agency_id = ca.id
GROUP BY DATE(pl.date), ca.agency_name
ORDER BY parcel_date DESC, ca.agency_name;

-- Generate courier bill data
SELECT
  ca.agency_name,
  COUNT(DISTINCT pl.id) AS total_entries,
  SUM(pl.boxes) AS total_boxes,
  cr.rate_per_box,
  SUM(pl.boxes) * cr.rate_per_box AS estimated_cost
FROM party_list pl
JOIN courier_agency_list ca ON pl.courier_agency_id = ca.id
LEFT JOIN courier_rates cr ON ca.id = cr.courier_agency_id
WHERE pl.date >= '2025-01-01' AND pl.date < '2025-02-01'
GROUP BY ca.agency_name, cr.rate_per_box;
```

### Label and Scanning

```sql
-- Get today's labels
SELECT
  lp.qr_code,
  lp.party_name,
  lp.address,
  lp.transport,
  lp.boxes,
  lp.status,
  lp.scanned_count
FROM label_prints lp
WHERE DATE(lp.created_at) = CURRENT_DATE
ORDER BY lp.created_at DESC;

-- Find missing scans
SELECT
  lp.qr_code,
  lp.party_name,
  lp.address,
  lp.transport,
  lp.boxes,
  lp.created_at
FROM label_prints lp
WHERE lp.status = 'missing'
  AND DATE(lp.created_at) = CURRENT_DATE
ORDER BY lp.created_at;

-- Scan completion rate by date
SELECT
  DATE(created_at) AS label_date,
  COUNT(*) AS total_labels,
  SUM(CASE WHEN status = 'scanned' THEN 1 ELSE 0 END) AS scanned,
  SUM(CASE WHEN status = 'missing' THEN 1 ELSE 0 END) AS missing,
  ROUND(
    SUM(CASE WHEN status = 'scanned' THEN 1 ELSE 0 END)::numeric /
    COUNT(*)::numeric * 100,
    2
  ) AS completion_percentage
FROM label_prints
GROUP BY DATE(created_at)
ORDER BY label_date DESC;

-- Recent scans with party info
SELECT
  st.qr_code,
  st.scanned_at,
  lp.party_name,
  lp.address,
  lp.transport
FROM scan_tally st
JOIN label_prints lp ON st.label_print_id = lp.id
WHERE st.status = 'scanned'
ORDER BY st.scanned_at DESC
LIMIT 50;
```

### Analysis and Reporting

```sql
-- Monthly summary
SELECT
  DATE_TRUNC('month', date) AS month,
  COUNT(*) AS total_entries,
  SUM(boxes) AS total_boxes,
  COUNT(DISTINCT party_code) AS unique_parties,
  COUNT(DISTINCT courier_agency_id) AS couriers_used
FROM party_list
GROUP BY DATE_TRUNC('month', date)
ORDER BY month DESC;

-- Top 10 parties by box count
SELECT
  pi.party_code,
  pi.party_name,
  COUNT(pl.id) AS total_shipments,
  SUM(pl.boxes) AS total_boxes
FROM party_information pi
JOIN party_list pl ON pi.party_code = pl.party_code
WHERE pl.date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY pi.party_code, pi.party_name
ORDER BY total_boxes DESC
LIMIT 10;

-- Courier performance comparison
SELECT
  ca.agency_name,
  COUNT(lp.id) AS labels_generated,
  SUM(lp.boxes) AS total_boxes,
  SUM(CASE WHEN lp.status = 'scanned' THEN 1 ELSE 0 END) AS scanned_labels,
  ROUND(
    SUM(CASE WHEN lp.status = 'scanned' THEN 1 ELSE 0 END)::numeric /
    COUNT(lp.id)::numeric * 100,
    2
  ) AS scan_rate
FROM courier_agency_list ca
JOIN label_prints lp ON ca.id = lp.courier_agency_id
WHERE DATE(lp.created_at) >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY ca.agency_name
ORDER BY scan_rate DESC;
```

### Flagged Parties

```sql
-- List all flagged parties
SELECT
  fp.party_code,
  fp.party_name,
  fp.address,
  fp.flagged_at,
  EXTRACT(DAY FROM CURRENT_TIMESTAMP - fp.flagged_at) AS days_flagged
FROM flagged_parties fp
ORDER BY fp.flagged_at DESC;

-- Flag a party
INSERT INTO flagged_parties (party_code, party_name, address)
SELECT party_code, party_name, address
FROM party_information
WHERE party_code = 'PARTY_CODE_HERE';

-- Unflag a party
DELETE FROM flagged_parties
WHERE party_code = 'PARTY_CODE_HERE';

-- Check if party is flagged
SELECT EXISTS(
  SELECT 1 FROM flagged_parties
  WHERE party_code = 'PARTY_CODE_HERE'
) AS is_flagged;
```

### Data Maintenance

```sql
-- Clean up old missing_scans (older than 90 days)
DELETE FROM missing_scans
WHERE cleared_at < CURRENT_DATE - INTERVAL '90 days';

-- Archive old scan_tally records (older than 180 days)
CREATE TABLE IF NOT EXISTS scan_tally_archive AS
SELECT * FROM scan_tally WHERE created_at < CURRENT_DATE - INTERVAL '180 days';

DELETE FROM scan_tally
WHERE created_at < CURRENT_DATE - INTERVAL '180 days';

-- Update statistics
ANALYZE party_information;
ANALYZE party_list;
ANALYZE label_prints;
ANALYZE scan_tally;

-- Find unused parties (no parcels in last 90 days)
SELECT
  pi.party_code,
  pi.party_name,
  MAX(pl.date) AS last_parcel_date
FROM party_information pi
LEFT JOIN party_list pl ON pi.party_code = pl.party_code
GROUP BY pi.party_code, pi.party_name
HAVING MAX(pl.date) < CURRENT_DATE - INTERVAL '90 days'
   OR MAX(pl.date) IS NULL
ORDER BY last_parcel_date NULLS FIRST;
```

### Auditing and Monitoring

```sql
-- Check database size
SELECT
  pg_size_pretty(pg_database_size(current_database())) AS database_size;

-- Table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) -
                 pg_relation_size(schemaname||'.'||tablename)) AS index_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Index usage statistics
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan AS scans,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- Recent migration history
SELECT
  migration_name,
  applied_at,
  description
FROM migration_log
ORDER BY applied_at DESC
LIMIT 10;

-- Active connections
SELECT
  datname,
  usename,
  application_name,
  client_addr,
  state,
  query_start
FROM pg_stat_activity
WHERE datname = current_database()
ORDER BY query_start DESC;
```

### Troubleshooting

```sql
-- Find duplicate QR codes (should be none)
SELECT qr_code, COUNT(*)
FROM label_prints
GROUP BY qr_code
HAVING COUNT(*) > 1;

-- Find orphaned records (no foreign key match)
SELECT pl.id, pl.party_code
FROM party_list pl
LEFT JOIN party_information pi ON pl.party_code = pi.party_code
WHERE pi.party_code IS NULL;

SELECT pl.id, pl.courier_agency_id
FROM party_list pl
LEFT JOIN courier_agency_list ca ON pl.courier_agency_id = ca.id
WHERE ca.id IS NULL AND pl.courier_agency_id IS NOT NULL;

-- Check trigger status
SELECT
  trigger_name,
  event_object_table,
  action_timing,
  event_manipulation
FROM information_schema.triggers
WHERE event_object_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- Verify data sync (party_list vs analysis_table)
SELECT
  DATE(pl.date) AS date,
  COUNT(pl.id) AS party_list_count,
  COUNT(at.id) AS analysis_table_count,
  COUNT(pl.id) - COUNT(at.id) AS difference
FROM party_list pl
LEFT JOIN analysis_table at ON
  DATE(pl.date) = DATE(at.date) AND
  pl.party_code = at.party_code
GROUP BY DATE(pl.date)
HAVING COUNT(pl.id) != COUNT(at.id);
```

### Bulk Operations

```sql
-- Bulk update courier rates
UPDATE courier_rates cr
SET rate_per_box = rate_per_box * 1.10  -- 10% increase
WHERE courier_agency_id IN (
  SELECT id FROM courier_agency_list
  WHERE agency_name LIKE 'Express%'
);

-- Bulk regenerate labels flag
UPDATE party_list
SET label_generated = false
WHERE DATE(date) = CURRENT_DATE
  AND courier_agency_id = 'UUID_HERE';

-- Bulk clear missing scans (move to archive)
INSERT INTO missing_scans (
  qr_code, party_name, address, transport,
  original_scan_time, cleared_at, reason
)
SELECT
  qr_code, party_name, address, transport,
  scanned_at, CURRENT_TIMESTAMP, 'Bulk clear operation'
FROM label_prints
WHERE status = 'missing'
  AND DATE(created_at) < CURRENT_DATE - INTERVAL '7 days';

-- Then update status
UPDATE label_prints
SET status = 'scanned', scanned_at = CURRENT_TIMESTAMP
WHERE status = 'missing'
  AND DATE(created_at) < CURRENT_DATE - INTERVAL '7 days';
```

## Useful Views

The schema includes two pre-built views:

### daily_parcel_summary
```sql
SELECT * FROM daily_parcel_summary
WHERE summary_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY summary_date DESC, courier_name;
```

### scan_statistics
```sql
SELECT * FROM scan_statistics
WHERE label_date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY label_date DESC;
```

## Performance Tips

1. **Always use indexes**: Check execution plans with `EXPLAIN ANALYZE`
2. **Batch operations**: Use transactions for multiple updates
3. **Limit results**: Use LIMIT for large result sets
4. **Use DATE functions**: For date-based filtering
5. **Leverage views**: For common reporting queries

## Best Practices

1. **Transactions**: Wrap related operations in transactions
2. **Error Handling**: Always check for constraint violations
3. **Data Validation**: Validate data before INSERT/UPDATE
4. **Regular Maintenance**: Run ANALYZE periodically
5. **Monitoring**: Track query performance and index usage

---

**Quick Reference Version**: 1.0.0
**Last Updated**: 2025-11-08
