let models;
try {
  models = require('./models');
} catch (e) {
  models = require('../backend/models');
}
const { Patient, Medicine, OpdVisit } = models;
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/punjabvoice';

const seedData = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB.');

    console.log('Seeding is disabled.');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
};

seedData();
