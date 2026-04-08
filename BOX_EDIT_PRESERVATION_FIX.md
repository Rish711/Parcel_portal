# Box Count Edit - Scanned Status Preservation Fix

## Problem Summary

When editing box count in Label Print (e.g., changing from 1 box to 2 boxes), the system was deleting ALL existing box QR codes and generating completely new ones. This caused previously scanned boxes to show as "missing" in Scan Tally, requiring users to re-scan boxes after corrections.

### Example Scenario (SHRI GANESH MEDICALS - Code: 11949)

**Before Fix:**
1. User creates label with 1 box → generates QR code `DS260101ABC123-B1`
2. User scans box 1 → marked as scanned ✓
3. User realizes there are 2 boxes and edits count to 2
4. System DELETED box 1 QR code (losing scanned status)
5. System generated NEW QR codes: `DS260101XYZ789-B1` and `DS260101XYZ789-B2`
6. Scan Tally now shows box 1 as "missing" even though it was already scanned
7. User has to re-scan box 1, which is confusing

**After Fix:**
1. User creates label with 1 box → generates QR code `DS260101ABC123-B1`
2. User scans box 1 → marked as scanned ✓
3. User realizes there are 2 boxes and edits count to 2
4. System PRESERVES box 1 QR code with its scanned status
5. System generates ONLY the new box 2: `DS260101ABC123-B2`
6. Scan Tally correctly shows box 1 as scanned, box 2 as pending
7. User only needs to scan the new box 2

## Solution Implemented

### 1. Database Function Update (`regenerate_box_qr_codes`)

**Location:** `supabase/migrations/preserve_scanned_status_on_box_regeneration.sql`

The function now intelligently handles three scenarios:

#### Case 1: Box Count Increases (1 → 2)
- **Action:** Keep all existing boxes with their scanned status
- **Generate:** Only new boxes (box 2 in this case)
- **Result:** Box 1 remains scanned, only box 2 is new and unscanned

#### Case 2: Box Count Decreases (3 → 2)
- **Action:** Keep first N boxes (boxes 1-2) with their scanned status
- **Delete:** Only boxes beyond the new count (box 3 deleted)
- **Result:** Boxes 1-2 retain their scanned status, box 3 removed

#### Case 3: Box Count Unchanged
- **Action:** No changes made
- **Result:** All QR codes and scanned status preserved

### 2. Frontend Improvements

**Location:** `src/components/LabelPrintTab.tsx`

Updated `handleSaveBoxes` function to:
- Query current scanned status before updating
- Provide detailed feedback messages:
  - "Added 1 box (1 already scanned preserved)"
  - "Removed 1 box (2 scanned preserved)"
- Show toast messages for 4 seconds with full details

### 3. Technical Details

**Database Function Logic:**
```sql
-- Increases: Keep existing, add new
IF p_box_count > v_current_count THEN
  -- Preserve existing boxes (with scanned status)
  -- Generate new boxes only for the additional count
  -- Use same base QR code for consistency
END IF;

-- Decreases: Keep first N, delete rest
IF p_box_count < v_current_count THEN
  -- Delete only boxes beyond new count
  -- Preserve boxes 1..N with scanned status
END IF;
```

**Trigger:**
- Automatically fires when `label_prints.boxes` is updated
- Only processes if box count actually changed
- Calls the smart preservation function

## Benefits

1. **No Data Loss:** Previously scanned boxes retain their status
2. **Better UX:** No need to re-scan after corrections
3. **Data Integrity:** Scan counts remain accurate
4. **Flexibility:** Allows corrections without disrupting workflow
5. **Clear Feedback:** Users see exactly what was preserved/added

## Testing Scenarios

### Scenario 1: Increase Boxes (1 → 2)
- ✅ Box 1 keeps scanned status
- ✅ Box 2 added as unscanned
- ✅ QR codes use same base ID

### Scenario 2: Decrease Boxes (3 → 2)
- ✅ Boxes 1-2 keep scanned status
- ✅ Box 3 deleted
- ✅ No orphaned QR codes

### Scenario 3: Multiple Edits (1 → 3 → 2)
- ✅ Scanned status preserved through all changes
- ✅ Correct boxes shown at each step

### Scenario 4: Already Complete Parcel
- ✅ Editing boxes on completed parcel works
- ✅ Previously scanned boxes remain scanned

## Migration Details

**File:** `preserve_scanned_status_on_box_regeneration.sql`
**Applied:** 2026-01-01
**Action:** Replaces existing `regenerate_box_qr_codes` function with smart version

### What Changed:
- ❌ OLD: Delete all box QR codes, regenerate all
- ✅ NEW: Smart preservation based on count change

### Backwards Compatibility:
- ✅ Function signature unchanged
- ✅ Existing triggers continue to work
- ✅ No data migration needed
- ✅ Works for all future edits automatically

## User Instructions

When editing box count in Label Print:

1. Click on the box count number to edit
2. Enter the new count (1-150)
3. Press Enter or click ✓
4. System will show what was preserved/added
5. Check Scan Tally - previously scanned boxes still show as scanned
6. Only scan the new boxes added

## Technical Notes

- Scanned status stored in `box_qr_codes.scanned` (boolean)
- Scan timestamp stored in `box_qr_codes.scanned_at` (timestamptz)
- Both fields preserved during box count changes
- QR code base ID maintained for consistency (same prefix)
- Trigger executes AFTER UPDATE to ensure data consistency

## Related Files

- `supabase/migrations/preserve_scanned_status_on_box_regeneration.sql` - Database function
- `src/components/LabelPrintTab.tsx` - Frontend UI updates
- `src/lib/labelPersistence.ts` - QR code regeneration helpers

## Future Enhancements

Potential improvements:
- Add bulk box count updates with preservation
- Show scanned/total count before editing
- Audit log of box count changes
- Rollback capability for accidental edits
