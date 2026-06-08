const mongoose = require('mongoose');
const { Patient } = require('./server/models');

async function test() {
  await mongoose.connect('mongodb://localhost:27017/counselflow');
  
  const patients = [{ id: 'PT-TEST-123', name: 'Test' }];
  const operations = patients.map(p => {
    return {
      updateOne: {
        filter: { id: p.id },
        update: { $set: p },
        upsert: true
      }
    };
  });
  
  const res = await Patient.bulkWrite(operations);
  console.log(res);
  
  const p = await Patient.findOne({ id: 'PT-TEST-123' });
  console.log("Found:", p);
  
  mongoose.disconnect();
}
test().catch(console.error);
