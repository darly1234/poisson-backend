const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    const script = `
cat << 'EOF' > /usr/local/apps/apache2/etc/conf.d/poisson-erp.conf
<VirtualHost 72.60.254.10:80>
    ServerName individual.poisson.com.br
    ServerAlias www.individual.poisson.com.br

    DocumentRoot /var/www/poisson-erp/build
    <Directory /var/www/poisson-erp/build>
        Options -Indexes
        AllowOverride All
        Require all granted
        FallbackResource /index.html
    </Directory>

    ProxyPass /api/ http://127.0.0.1:3001/api/
    ProxyPassReverse /api/ http://127.0.0.1:3001/api/
</VirtualHost>

<VirtualHost 72.60.254.10:443>
    ServerName individual.poisson.com.br
    ServerAlias www.individual.poisson.com.br

    SSLEngine on
    SSLCertificateFile "/var/webuzo/users/darly/ssl/individual.poisson.com.br-combined.pem"

    DocumentRoot /var/www/poisson-erp/build
    <Directory /var/www/poisson-erp/build>
        Options -Indexes
        AllowOverride All
        Require all granted
        FallbackResource /index.html
    </Directory>

    ProxyPass /api/ http://127.0.0.1:3001/api/
    ProxyPassReverse /api/ http://127.0.0.1:3001/api/
</VirtualHost>
EOF
systemctl restart httpd
`;
    conn.exec(script, (err, stream) => {
        if (err) throw err;
        let out = '';
        stream.on('close', () => { console.log("Done"); conn.end(); })
            .on('data', data => out += data)
            .stderr.on('data', data => out += data);
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
