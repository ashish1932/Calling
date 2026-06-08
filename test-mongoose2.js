const mongoose = require('mongoose');
const { Patient } = require('./server/models');

async function test() {
  await mongoose.connect('mongodb://127.0.0.1:27017/counselflow');
  
  const p = await Patient.findOne({ id: 'PT-TEST-123' });
  console.log("Found:", p);
  
  mongoose.disconnect();
}
test().catch(console.error);
