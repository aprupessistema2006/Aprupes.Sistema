/**
 * Diagnostic test for duplicate data issue
 * Run this to understand where duplicates are created
 */

const TEST_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxfELoRysUW2HQlC1bujHSaB2nmiUAZQp_yHvXBjxVN7yUEqbBizGrB15vSPcGUn9LUzA/exec',
  SHEET_ID: '1OQAdiHsuQEwy180b68oHQ9xxELFV2_CkqDJY7ej0P5E'
};

async function runDiagnostics() {
  console.log('=== DUPLICATE DATA DIAGNOSTIC TEST ===\n');

  // Test 1: Check current state of Google Sheets
  console.log('TEST 1: Checking current Google Sheets data...');
  try {
    const response = await fetch(`${TEST_CONFIG.GAS_URL}?action=load&t=${Date.now()}`);
    const data = await response.json();

    console.log('Employees in Google Sheets:');
    (data.darbinieki || []).forEach((emp, i) => {
      console.log(`  ${i+1}. ID: ${emp.id}, Name: ${emp.vards} ${emp.uzvards}, Role: ${emp.loma}, PIN: ${emp.pin_kods || emp.pin}`);
    });

    // Check for duplicates
    const seen = new Map();
    const duplicates = [];
    (data.darbinieki || []).forEach(emp => {
      const key = `${emp.vards}|${emp.uzvards}|${emp.loma}`;
      if (seen.has(key)) {
        duplicates.push(emp);
      } else {
        seen.set(key, emp);
      }
    });

    if (duplicates.length > 0) {
      console.log('\n⚠️  DUPLICATES FOUND IN GOOGLE SHEETS:');
      duplicates.forEach(dup => {
        console.log(`  - ID: ${dup.id}, Name: ${dup.vards} ${dup.uzvards}, Role: ${dup.loma}`);
      });
    } else {
      console.log('\n✓ No duplicates in Google Sheets');
    }

    console.log(`\nTotal employees: ${(data.darbinieki || []).length}`);
  } catch (error) {
    console.error('Error checking Google Sheets:', error.message);
  }

  // Test 2: Simulate rapid create operations
  console.log('\n\nTEST 2: Simulating rapid create operations...');
  console.log('This test checks if rapid clicking creates duplicates.');

  // Simulate creating the same employee twice
  const testEmployee = {
    vards: 'Test',
    uzvards: 'User',
    loma: 'aprūpētājs',
    pin: '1234'
  };

  console.log(`Attempting to create: ${testEmployee.vards} ${testEmployee.uzvards} (${testEmployee.loma})`);

  // First creation
  try {
    const result1 = await fetch(TEST_CONFIG.GAS_URL + '?data=' + encodeURIComponent(JSON.stringify({
      action: 'createEmployee',
      data: testEmployee
    })));
    const data1 = await result1.json();
    console.log('First creation result:', data1);
  } catch (err) {
    console.error('First creation error:', err.message);
  }

  // Second creation (simulating double-click)
  try {
    const result2 = await fetch(TEST_CONFIG.GAS_URL + '?data=' + encodeURIComponent(JSON.stringify({
      action: 'createEmployee',
      data: testEmployee
    })));
    const data2 = await result2.json();
    console.log('Second creation result:', data2);
  } catch (err) {
    console.error('Second creation error:', err.message);
  }

  // Wait a bit and check if duplicates were created
  await new Promise(resolve => setTimeout(resolve, 2000));

  try {
    const response = await fetch(`${TEST_CONFIG.GAS_URL}?action=load&t=${Date.now()}`);
    const data = await response.json();
    const testEmployees = (data.darbinieki || []).filter(e =>
      e.vards === 'Test' && e.uzvards === 'User' && e.loma === 'aprūpētājs'
    );

    console.log(`\nTest employees found after double-creation: ${testEmployees.length}`);
    if (testEmployees.length > 1) {
      console.log('⚠️  DUPLICATES CREATED BY RAPID CLICKS!');
      testEmployees.forEach((emp, i) => {
        console.log(`  ${i+1}. ID: ${emp.id}`);
      });
    }
  } catch (error) {
    console.error('Error checking test results:', error.message);
  }

  // Test 3: Check sync queue behavior
  console.log('\n\nTEST 3: Checking sync queue behavior...');
  console.log('The sync queue might cause duplicates if requests are retried.');

  // Test 4: Check if local cache vs remote mismatch
  console.log('\n\nTEST 4: Checking local cache vs remote consistency...');
  console.log('The app uses IndexedDB as a local cache.');
  console.log('If the cache is not properly cleared on load, duplicates can occur.');

  // Test 5: Check for race conditions
  console.log('\n\nTEST 5: Checking for race conditions...');
  console.log('Race conditions can occur if loadInitialData is called while sync is in progress.');

  console.log('\n=== DIAGNOSTIC COMPLETE ===');
  console.log('\nPOSSIBLE CAUSES OF DUPLICATES:');
  console.log('1. Rapid clicking the "Pievienot" button');
  console.log('2. Sync queue retry logic sending duplicate requests');
  console.log('3. Local cache not being cleared properly before loading');
  console.log('4. Multiple devices creating the same employee');
  console.log('5. Page reload while sync is in progress');
  console.log('\nRECOMMENDED FIXES:');
  console.log('1. Add server-side duplicate checking before creating');
  console.log('2. Add client-side debouncing to prevent rapid clicks');
  console.log('3. Add unique constraint checking in Google Sheets');
  console.log('4. Implement proper sync state management');
  console.log('5. Add loading indicators to prevent user interaction during sync');
}

// Run the diagnostics
runDiagnostics().catch(console.error);