const https = require('https');

const url = 'https://api-marketplace.anandamcomputer.com/uploads/products/thumbnails/533cca368864bd36bcb750cf4422c710.jpg';

https.get(url, (res) => {
  console.log('Status Code:', res.statusCode);
  console.log('Headers:', res.headers);
}).on('error', (e) => {
  console.error(e);
});
