/**
 * Test script to verify duplicate prevention fixes
 */

const TEST_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwyrmtaeCwzCNhoDYn2_ceS2m2GxX0A5lE-rL2SMvAK75Hy2Kh-KB8BNsNuk6jgJmvorw/exec',
  SHEET_ID: '1OQAdiHsuQEwy180b68oHQ9xxELFV2_CkqDJY7ej0P5E'
};

async function testDuplicatePrevention() {
  console.log('=== TESTING DUPLICATE PREVENTION FIXES ===\n');

  // Test 1: Check current state
  console.log('Test 1: Checking current Google Sheets data...');
  try {
    const response = await fetch(`${TEST_CONFIG.GAS_URL}?action=load&t=${Date.now()}`);
    const data = await response.json();

    console.log(`Employees: ${(data.darbinieki || []).length}`);
    console.log(`Clients: ${(data.klienti || []).length}`);

    // Check for duplicates
    const empDuplicates = findDuplicates(data.darbinieki || [], ['vards', 'uzvards', 'loma']);
    const clientDuplicates = findDuplicates(data.klienti || [], ['vards', 'uzvards']);

    if (empDuplicates.length > 0) {
      console.log(`\n⚠️  Found ${empDuplicates.length} duplicate employee groups`);
    } else {
      console.log('✓ No duplicate employees');
    }

    if (clientDuplicates.length > 0) {
      console.log(`\n⚠️  Found ${clientDuplicates.length} duplicate client groups`);
    } else {
      console.log('✓ No duplicate clients');
    }

  } catch (error) {
    console.error('Error:', error.message);
  }

  // Test 2: Test duplicate prevention on employee creation
  console.log('\n\nTest 2: Testing employee duplicate prevention...');
  const testEmp = {
    vards: 'Test',
    uzvards: 'Duplicate',
    loma: 'aprūpētājs',
    pin: '5555'
  };

  // Try to create the same employee twice
  const results = [];
  for (let i = 0; i < 2; i++) {
    try {
      const result = await fetch(`${TEST_CONFIG.GAS_URL}?data=${encodeURIComponent(JSON.stringify({
        action: 'createEmployee',
        data: testEmp
      }))}`);
      const data = await result.json();
      results.push(data);
      console.log(`Attempt ${i+1}:`, data);
    } catch (err) {
      console.error(`Attempt ${i+1} error:`, err.message);
    }
  }

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Check if duplicates were created
  try {
    const response = await fetch(`${TEST_CONFIG.GAS_URL}?action=load&t=${Date.now()}`);
    const data = await response.json();
    const testEmployees = (data.darbinieki || []).filter(e =>
      e.vards === testEmp.vards &&
      e.uzvards === testEmp.uzvards &&
      e.loma === testEmp.loma
    );

    console.log(`\nTest employees found: ${testEmployees.length}`);
    if (testEmployees.length > 1) {
      console.log('❌ DUPLICATES STILL BEING CREATED - Fix not working');
    } else if (testEmployees.length === 1) {
      console.log('✓ Duplicate prevention working correctly');
    } else {
      console.log('⚠️  No test employees found (creation may have failed)');
    }
  } catch (error) {
    console.error('Error checking results:', error.message);
  }

  // Test 3: Test duplicate prevention on client creation
  console.log('\n\nTest 3: Testing client duplicate prevention...');
  const testClient = {
    vards: 'Test',
    uzvards: 'Client',
    dzimis: '1990-01-01'
  };

  // Try to create the same client twice
  const clientResults = [];
  for (let i = 0; i < 2; i++) {
    try {
      const result = await fetch(`${TEST_CONFIG.GAS_URL}?data=${encodeURIComponent(JSON.stringify({
        action: 'createClient',
        data: testClient
      }))}`);
      const data = await result.json();
      clientResults.push(data);
      console.log(`Attempt ${i+1}:`, data);
    } catch (err) {
      console.error(`Attempt ${i+1} error:`, err.message);
    }
  }

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Check if duplicates were created
  try {
    const response = await fetch(`${TEST_CONFIG.GAS_URL}?action=load&t=${Date.now()}`);
    const data = await response.json();
    const testClients = (data.klienti || []).filter(c =>
      c.vards === testClient.vards &&
      c.uzvards === testClient.uzvards
    );

    console.log(`\nTest clients found: ${testClients.length}`);
    if (testClients.length > 1) {
      console.log('❌ DUPLICATES STILL BEING CREATED - Fix not working');
    } else if (testClients.length === 1) {
      console.log('✓ Duplicate prevention working correctly');
    } else {
      console.log('⚠️  No test clients found (creation may have failed)');
    }
  } catch (error) {
    console.error('Error checking results:', error.message);
  }

  console.log('\n=== TEST COMPLETE ===');
}

function findDuplicates(items, fields) {
  const seen = new Map();
  const duplicates = [];

  items.forEach(item => {
    const key = fields.map(f => item[f] || '').join('|').toLowerCase();
    if (seen.has(key)) {
      duplicates.push(item);
    } else {
      seen.set(key, item);
    }
  });

  return duplicates;
}

testDuplicatePrevention().catch(console.error);