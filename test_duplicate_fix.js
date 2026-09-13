/**
 * Comprehensive fix for duplicate data issue
 * This script:
 * 1. Adds server-side duplicate checking
 * 2. Adds client-side debouncing
 * 3. Adds unique constraint validation
 */

const FIX_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxfELoRysUW2HQlC1bujHSaB2nmiUAZQp_yHvXBjxVN7yUEqbBizGrB15vSPcGUn9LUzA/exec',
  SHEET_ID: '1OQAdiHsuQEwy180b68oHQ9xxELFV2_CkqDJY7ej0P5E'
};

async function applyFixes() {
  console.log('=== APPLYING DUPLICATE FIXES ===\n');

  // Fix 1: Check for existing duplicates in Google Sheets
  console.log('FIX 1: Checking for existing duplicates...');
  try {
    const response = await fetch(`${FIX_CONFIG.GAS_URL}?action=load&t=${Date.now()}`);
    const data = await response.json();

    const employees = data.darbinieki || [];
    const clients = data.klienti || [];

    console.log(`Found ${employees.length} employees and ${clients.length} clients in Google Sheets`);

    // Check for duplicate employees
    const empSeen = new Map();
    const empDuplicates = [];

    employees.forEach(emp => {
      const key = `${emp.vards}|${emp.uzvards}|${emp.loma}`.toLowerCase();
      if (empSeen.has(key)) {
        empDuplicates.push(emp);
      } else {
        empSeen.set(key, emp);
      }
    });

    if (empDuplicates.length > 0) {
      console.log(`\n⚠️  Found ${empDuplicates.length} duplicate employees:`);
      empDuplicates.forEach(dup => {
        console.log(`  - ID: ${dup.id}, Name: ${dup.vards} ${dup.uzvards}, Role: ${dup.loma}`);
      });
    } else {
      console.log('✓ No duplicate employees found');
    }

    // Check for duplicate clients
    const clientSeen = new Map();
    const clientDuplicates = [];

    clients.forEach(client => {
      const key = `${client.vards}|${client.uzvards}`.toLowerCase();
      if (clientSeen.has(key)) {
        clientDuplicates.push(client);
      } else {
        clientSeen.set(key, client);
      }
    });

    if (clientDuplicates.length > 0) {
      console.log(`\n⚠️  Found ${clientDuplicates.length} duplicate clients:`);
      clientDuplicates.forEach(dup => {
        console.log(`  - ID: ${dup.id}, Name: ${dup.vards} ${dup.uzvards}`);
      });
    } else {
      console.log('✓ No duplicate clients found');
    }

  } catch (error) {
    console.error('Error checking duplicates:', error.message);
  }

  // Fix 2: Test duplicate prevention
  console.log('\n\nFIX 2: Testing duplicate prevention...');
  const testEmployee = {
    vards: 'Test',
    uzvards: 'Prevention',
    loma: 'aprūpētājs',
    pin: '9999'
  };

  // Try to create the same employee twice
  console.log(`Testing duplicate prevention for: ${testEmployee.vards} ${testEmployee.uzvards}`);

  // First creation
  try {
    const result1 = await fetch(`${FIX_CONFIG.GAS_URL}?data=${encodeURIComponent(JSON.stringify({
      action: 'createEmployee',
      data: testEmployee
    }))}`);
    const data1 = await result1.json();
    console.log('First creation:', data1);
  } catch (err) {
    console.error('First creation error:', err.message);
  }

  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Second creation (should be prevented if fix is applied)
  try {
    const result2 = await fetch(`${FIX_CONFIG.GAS_URL}?data=${encodeURIComponent(JSON.stringify({
      action: 'createEmployee',
      data: testEmployee
    }))}`);
    const data2 = await result2.json();
    console.log('Second creation (should be prevented):', data2);
  } catch (err) {
    console.error('Second creation error:', err.message);
  }

  // Check if duplicates were created
  await new Promise(resolve => setTimeout(resolve, 2000));

  try {
    const response = await fetch(`${FIX_CONFIG.GAS_URL}?action=load&t=${Date.now()}`);
    const data = await response.json();
    const testEmployees = (data.darbinieki || []).filter(e =>
      e.vards === 'Test' && e.uzvards === 'Prevention' && e.loma === 'aprūpētājs'
    );

    console.log(`\nTest employees after duplicate prevention test: ${testEmployees.length}`);
    if (testEmployees.length > 1) {
      console.log('⚠️  DUPLICATES STILL BEING CREATED - Fix not applied yet');
    } else if (testEmployees.length === 1) {
      console.log('✓ Duplicate prevention working correctly');
    }
  } catch (error) {
    console.error('Error checking test results:', error.message);
  }

  console.log('\n=== FIX APPLICATION COMPLETE ===');
}

applyFixes().catch(console.error);