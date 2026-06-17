const { exec, spawn } = require('child_process');

console.log('🔄 Cleaning up existing ports (8081) and tunnels...');
exec('fuser -k 8081/tcp; pkill -f tunnelmole || true', () => {
  
  console.log('🚀 Starting local Expo Metro Server with cleared cache...');
  const metro = spawn('npx', ['expo', 'start', '--clear'], {
    env: { ...process.env, EXPO_NO_TELEMETRY: '1' },
    stdio: 'inherit'
  });

  console.log('🛰️ Starting independent tunnelmole tunnel on port 8081...');
  const tunnelmole = spawn('npx', ['tunnelmole', '8081']);

  let foundUrl = false;
  tunnelmole.stdout.on('data', (data) => {
    const text = data.toString();
    
    if (!foundUrl) {
      const match = text.match(/(https:\/\/[a-zA-Z0-9\-\.]+tunnelmole\.net)/);
      if (match) {
        foundUrl = true;
        const url = match[1];
        const expUrl = url.replace('https://', 'exp://');
        console.log('\n======================================================');
        console.log('✅ EXPO TUNNEL IS ONLINE (No EAS Login Required!)');
        console.log('======================================================\n');
        console.log('👉 Copy and paste this URL into your Expo Go app search bar:');
        console.log(`\n    ${expUrl}\n`);
        console.log('======================================================\n');
      }
    }
  });

  process.on('SIGINT', () => {
    console.log('\n🛑 Stopping servers...');
    metro.kill();
    tunnelmole.kill();
    process.exit();
  });
});
