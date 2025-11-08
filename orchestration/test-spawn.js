// Debugging script to test if Node.js can spawn Python processes

const { spawn } = require('child_process');

// Test 1: Can we spawn Python at all?
console.log('Test 1: Spawning /opt/anaconda3/bin/python --version');
const test1 = spawn('/opt/anaconda3/bin/python', ['--version']);

test1.stdout.on('data', (data) => {
  console.log('  ✓ stdout:', data.toString().trim());
});

test1.stderr.on('data', (data) => {
  console.log('  ✓ stderr:', data.toString().trim());
});

test1.on('error', (error) => {
  console.error('  ✗ Error:', error.message);
});

test1.on('close', (code) => {
  console.log('  Exit code:', code);

  // Test 2: Can we run the worker?
  console.log('\nTest 2: Running worker --help');
  const test2 = spawn('/opt/anaconda3/bin/python', ['-m', 'src.cli', '--help'], {
    cwd: '/Users/egorr/Documents/Coding-Projects/AnatomicalModeling/imaging-worker',
  });

  test2.stdout.on('data', (data) => {
    console.log('  ✓ stdout:', data.toString());
  });

  test2.stderr.on('data', (data) => {
    console.log('  stderr:', data.toString());
  });

  test2.on('error', (error) => {
    console.error('  ✗ Error:', error.message);
  });

  test2.on('close', (code) => {
    console.log('  Exit code:', code);
  });
});
