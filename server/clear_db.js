const mongoose = require('mongoose');

mongoose.connect('mongodb://localhost:27017/counselflow')
  .then(async () => {
    console.log('Connected to MongoDB');
    await mongoose.connection.db.dropDatabase();
    console.log('Database dropped');
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
