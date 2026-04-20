const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    console.log('Connected to VPS...');
    const script = `
echo "Killing processes on port 3001..."
fuser -k 3001/tcp
echo "Listing PM2 processes..."
pm2 list
echo "Deleting all PM2 processes to start fresh..."
pm2 delete all
echo "Starting backend API..."
cd /var/www/poisson-backend
pm2 start server.js --name poisson-api
echo "PM2 list after restart:"
pm2 list
`;
    conn.exec(script, (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end())
            .on('data', data => process.stdout.write(data))
            .stderr.on('data', data => process.stderr.write(data));
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
