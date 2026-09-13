# DUPLICATE DATA ISSUE - DIAGNOSIS AND FIX

## Problem Summary
The application was creating duplicate entries in Google Sheets for employees and clients, even though the local interface showed correct data. The duplicates appeared because the application was reading from local IndexedDB cache, not directly from Google Sheets.

## Root Causes Identified

### 1. No Server-Side Duplicate Checking
The Google Apps Script (GAS) backend did NOT check if an employee/client already existed before creating a new entry. This meant:
- Multiple rapid clicks would create multiple entries
- Network retries could create duplicates if the first request succeeded but the response was lost
- Multiple devices could create the same entry independently

### 2. Race Conditions from Rapid Clicking
The UI had no debouncing mechanism, so:
- Users could click "Pievienot" multiple times quickly
- Each click would trigger a separate creation request
- All requests would succeed, creating duplicates

### 3. Local Cache vs Remote Data Mismatch
The app uses IndexedDB as a local cache:
- When loading, it clears local data and reloads from Google Sheets
- But if the sync queue has pending items, they might create duplicates
- The local `this.employees` array only checks for duplicates in memory, not in Google Sheets

### 4. Sync Queue Retry Logic
The sync queue retries failed requests:
- If a request fails (network error), it's retried later
- If the first request actually succeeded on the server but the response was lost, retrying creates a duplicate
- The queue item is only deleted after a successful response

## Fixes Applied

### Fix 1: Server-Side Duplicate Prevention (backend/gas_webhook.gs)
Added duplicate checking in `handleCreateClient()` and `handleCreateEmployee()`:

```javascript
function handleCreateClient(data) {
  const sheet = getSheet('klienti');
  const c = data.data;

  // DUPLICATE PREVENTION: Check if client already exists
  const existing = findRow(sheet, [
    ['vards', c.vards || ''],
    ['uzvards', c.uzvards || '']
  ]);
  if (existing) {
    return { error: 'Klients ar šo vārdu un uzvārdu jau pastāv', existingId: existing.row };
  }

  // ... create new entry
}
```

### Fix 2: Client-Side Debouncing (js/admin.js)
Added 300ms debounce to prevent rapid clicks:

```javascript
async createClient(data) {
  // Prevent duplicate submissions
  if (this._createClientDebounce) {
    clearTimeout(this._createClientDebounce);
  }

  return new Promise((resolve, reject) => {
    this._createClientDebounce = setTimeout(async () => {
      // ... creation logic
    }, 300); // 300ms debounce
  });
}
```

### Fix 3: Enhanced Local Duplicate Check (js/admin.js)
Improved the local duplicate check to be more robust:

```javascript
async createEmployee(data) {
  // ... validation
  
  // Prevent duplicate submissions with debounce
  if (this._createEmployeeDebounce) {
    clearTimeout(this._createEmployeeDebounce);
  }

  return new Promise((resolve, reject) => {
    this._createEmployeeDebounce = setTimeout(async () => {
      try {
        // Check for duplicate in local data
        const existing = this.employees.find(e => {
          const eName = ((e.vards || e.Vārds || '') + ' ' + (e.uzvards || e.Uzvārds || '')).trim().toLowerCase();
          const eRole = (e.loma || e.Loma || '').toLowerCase();
          const newName = ((data.vards || '') + ' ' + (data.uzvards || '')).trim().toLowerCase();
          const newRole = (data.loma || '').toLowerCase();
          return eName === newName && eRole === newRole;
        });
        if (existing) {
          this.toast('Darbinieks ar šo vārdu un lomu jau eksistē');
          reject(new Error('Duplicate employee'));
          return;
        }

        // ... create employee
      } catch (error) {
        reject(error);
      }
    }, 300); // 300ms debounce
  });
}
```

## Files Modified

1. **backend/gas_webhook.gs**
   - Added duplicate checking in `handleCreateClient()`
   - Added duplicate checking in `handleCreateEmployee()`

2. **js/admin.js**
   - Added `_createClientDebounce` and `_createEmployeeDebounce` properties
   - Added debouncing to `createClient()` method
   - Added debouncing to `createEmployee()` method
   - Enhanced local duplicate checking

## Testing

To verify the fixes work correctly, you can run:
- `node test_verify_fixes.js` - Tests duplicate prevention
- `node test.js` - Runs existing unit tests
- `node test_e2e.js` - Runs end-to-end tests

## Additional Recommendations

1. **Add Unique Constraints**: Consider adding a unique constraint on the Google Sheets for the combination of (vards, uzvards, loma) for employees and (vards, uzvards) for clients.

2. **Implement Idempotency Keys**: For critical operations, implement idempotency keys to prevent duplicate processing of the same request.

3. **Better Error Handling**: The client should handle the error response from the server when a duplicate is detected and provide clear feedback to the user.

4. **Sync Queue Monitoring**: Add better monitoring of the sync queue to detect and handle stuck items that might cause duplicates.

5. **Data Cleanup**: You may want to run a cleanup script to remove existing duplicates from Google Sheets.

## How to Apply These Fixes

The fixes have already been applied to the files in this repository. To use them:

1. Deploy the updated `backend/gas_webhook.gs` to Google Apps Script
2. The client-side changes in `js/admin.js` are already in place
3. Refresh the admin page in your browser to load the updated code

If you need to revert or modify the fixes, refer to the original code patterns in the repository history.