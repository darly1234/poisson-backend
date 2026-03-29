const sharp = require('sharp');
const fs = require('fs');
const imgPath = '/home/darly/projeto_poisson_erp/temp_posts/post_1774300707294.jpg';

async function check() {
    if (!fs.existsSync(imgPath)) {
        console.log('Arquivo não encontrado:', imgPath);
        return;
    }
    try {
        const metadata = await sharp(imgPath).metadata();
        console.log('METADATA_START');
        console.log(JSON.stringify({
            width: metadata.width,
            height: metadata.height,
            format: metadata.format,
            size: fs.statSync(imgPath).size,
            ratio: (metadata.width / metadata.height).toFixed(4)
        }, null, 2));
        console.log('METADATA_END');
    } catch (e) {
        console.error('Erro:', e.message);
    }
}
check();
