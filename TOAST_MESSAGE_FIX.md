# Toast Message Fix - Scan Tally Tab

## Problem
Users were seeing **multiple contradictory toast messages** for a single QR scan:
1. Red error: "QR code not found"
2. Red error: "Already scanned all boxes"
3. Green success: "1/1 scanned"

This created confusion about whether the scan actually succeeded or failed.

## Root Cause
The cache-miss path in `ScanTallyTab.tsx` had a flawed architecture:

1. **Premature frontend validation** - Checked if QR exists, showed "not found" error
2. **Premature "already scanned" check** - Showed error before backend confirmed
3. **Optimistic success toast** - Showed success IMMEDIATELY without waiting for backend
4. **Background backend call** - `markBarcodeAsScanned()` ran in background (non-blocking)
5. **Contradictory error toast** - If backend failed, showed ANOTHER error toast

Result: Frontend showed optimistic success, but backend validation could fail and show a different error, creating contradictory messages.

## Solution

### New Flow (Cache-Miss Path)

**Step 1: Quick Label Lookup**
- Query both `box_qr_codes` and `label_prints` in parallel
- Get basic label info for frontend validations ONLY
- **No error toast** if QR not found - let backend handle this

**Step 2: Frontend-Only Validations**
- Check if party is flagged (frontend filter)
- Check if courier matches selected courier (frontend filter)
- If validation fails, show error and STOP (don't call backend)

**Step 3: Call Backend**
- Call `markBarcodeAsScanned()` with `await` (BLOCKING, not background)
- Backend validates:
  - QR code exists
  - Box not already scanned
  - Not all boxes already scanned
- Backend returns result or throws error

**Step 4: Show ONE Message**
- **On success:** Show single success toast with box number
- **On error:** Catch exception and show single error toast
- **No contradictions possible** - backend is single source of truth

### What Changed

**Removed:**
- ❌ Frontend "QR not found" error toast
- ❌ Frontend "already fully scanned" error toast
- ❌ Optimistic success toast before backend confirms
- ❌ Background non-blocking `markBarcodeAsScanned()` call
- ❌ Second success toast with box number (caused duplicates)

**Added:**
- ✅ Lightweight label info query for frontend filters only
- ✅ Blocking `await` call to backend before showing any toast
- ✅ Single success toast with box number included immediately
- ✅ Single error toast from backend's authoritative validation

### Cache-Hit Path (Unchanged)

The cache-hit path remains optimistic and ultra-fast because:
- Cache data is reliable and up-to-date
- No race conditions with other tabs (realtime sync handles this)
- Speed is critical for rapid scanning workflow

## Benefits

1. **One message per scan** - Users never see contradictory toasts
2. **Clear and accurate** - Message reflects what actually happened
3. **Backend is source of truth** - Validation happens in one place
4. **Better error messages** - Backend provides detailed, accurate errors:
   - "Barcode not found in today's entries"
   - "Box 1 already scanned for PARTY NAME"
   - "All boxes already scanned for PARTY NAME"

## Testing Checklist

- [x] Build succeeds without errors
- [ ] Single toast shown for successful scan
- [ ] Single error toast for "QR not found"
- [ ] Single error toast for "already scanned"
- [ ] No contradictory messages ever appear
- [ ] Flagged party check still works
- [ ] Courier filter still works
- [ ] Cache-hit path remains fast (under 50ms)

## Expected Behavior After Fix

### Scenario 1: Valid scan
```
User scans QR → "Scanning..." (100-200ms) → "PARTY NAME: 1/3 scanned (Box 1)" ✅
```

### Scenario 2: QR not found
```
User scans QR → "Scanning..." → "Barcode XYZ not found in today's entries" ❌
```

### Scenario 3: Already scanned
```
User scans QR → "Scanning..." → "Box 1 already scanned for PARTY NAME" ❌
```

### Scenario 4: All boxes scanned
```
User scans QR → "Scanning..." → "All boxes already scanned for PARTY NAME" ❌
```

### Scenario 5: Flagged party
```
User scans QR → "Scanning..." → "Party PARTY NAME is flagged" ❌
```

### Scenario 6: Wrong courier
```
User scans QR → "Scanning..." → "Wrong courier. Expected: DHL" ❌
```

**ONE CLEAR MESSAGE PER SCAN - NO CONFUSION!**
