const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    const counselors = [
        { id: 'STAFF-003', name: 'Dr. Amanpreet Kaur', role: 'counselor', district: 'Amritsar' },
        { id: 'STAFF-004', name: 'Dr. Manpreet Sodhi', role: 'counselor', district: 'Jalandhar' },
        { id: 'STAFF-005', name: 'Dr. Harinder Gill', role: 'counselor', district: 'Ludhiana' },
        { id: 'STAFF-006', name: 'Dr. Gurbaksh Singh', role: 'counselor', district: 'Patiala' }
    ];
    for (let c of counselors) {
        await mongoose.connection.db.collection('counselors').updateOne(
            { id: c.id },
            { $set: c },
            { upsert: true }
        );
    }
    console.log('Counselors seeded to actual DB successfully');
    process.exit(0);
}).catch(console.error);
